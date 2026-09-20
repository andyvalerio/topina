/**
 * Where events come from.
 *
 * Both sources yield the same shape — `{ receivedMs, event }` — so the signal
 * pipeline neither knows nor cares whether it is watching a live cat or
 * replaying a file. That is what makes it possible to develop and tune against
 * recordings instead of waiting for weather, a cat, and an incident to
 * coincide.
 *
 * `receivedMs` is our clock at the moment the event arrived. Replaying uses
 * the timestamp recorded at the time, so staleness behaves exactly as it did
 * during the original run.
 */
import { readFile } from 'node:fs/promises';
import { listen } from './channel.js';

/**
 * The live channel.
 * @param {{email: string, password: string}} credentials
 * @param {{signal?: AbortSignal}} [options]
 */
export async function* liveSource(credentials, { signal } = {}) {
    for await (const event of listen(credentials, { signal })) {
        yield { receivedMs: Date.now(), event };
    }
}

/**
 * A recording, replayed.
 *
 * @param {string} path a .jsonl written by record.js
 * @param {{pace?: number}} [options] 0 replays as fast as possible; 1 is real
 *   time; 10 is ten times faster than real time
 */
export async function* fileSource(path, { pace = 0 } = {}) {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    let previous = null;

    for (const line of lines) {
        const { received, event, phase } = JSON.parse(line);

        if (pace > 0 && previous !== null) {
            const wait = (received - previous) / pace;
            if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        previous = received;

        yield { receivedMs: received, event, phase };
    }
}
