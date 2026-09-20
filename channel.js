/**
 * The Tractive push channel.
 *
 * A long-lived POST that never finishes: the server writes one JSON object per
 * line for as long as the connection is held. This is the only way to get live
 * data — the REST API rate-limits after roughly two calls to the same resource,
 * so polling is not an option.
 *
 * Neither community wrapper implements this, so it's ours.
 */
import { authenticate, authHeaders, session } from './auth.js';

const CHANNEL_URL = 'https://channel.tractive.com/3/channel';

/** Messages that carry no information beyond "the connection is alive". */
export const HEARTBEAT_MESSAGES = new Set(['keep-alive', 'handshake']);

/**
 * Open the channel and yield every event the server sends, heartbeats
 * included — callers decide what to ignore.
 *
 * Reconnects on a dropped connection and re-authenticates on 401/403, because
 * a monitor that quietly stops monitoring is worse than one that crashes.
 *
 * @param {{email: string, password: string}} credentials
 * @param {{signal?: AbortSignal}} [options]
 * @returns {AsyncGenerator<object>}
 */
export async function* listen(credentials, { signal } = {}) {
    let auth = await session(credentials);

    while (!signal?.aborted) {
        let response;
        try {
            response = await fetch(CHANNEL_URL, {
                method: 'POST',
                headers: authHeaders(auth.token),
                signal,
            });
        } catch (err) {
            if (signal?.aborted) return;
            throw err;
        }

        if (response.status === 401 || response.status === 403) {
            // The cached token is stale; mint a fresh one rather than
            // reusing the cache that just failed.
            auth = await authenticate(credentials);
            continue;
        }

        if (!response.ok) {
            throw new Error(`channel failed: HTTP ${response.status}`);
        }

        yield* readLines(response.body, signal);
    }
}

/**
 * Decode a stream into parsed JSON objects, one per line.
 *
 * Chunks don't respect line boundaries, so a partial line has to be carried
 * over rather than parsed and dropped.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortSignal} [signal]
 * @returns {AsyncGenerator<object>}
 */
async function* readLines(body, signal) {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of body) {
        if (signal?.aborted) return;
        buffer += decoder.decode(chunk, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                yield JSON.parse(line);
            } catch {
                // A malformed line is worth knowing about but not worth dying for.
                console.error('unparseable channel line:', line.slice(0, 200));
            }
        }
    }
}
