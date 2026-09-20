/**
 * Tractive authentication.
 *
 * The wrapper authenticates too, but it keeps the token on `globalThis` and
 * hides the client ID inside its module — neither of which works for the
 * channel client, which needs both explicitly and needs to know when the token
 * expires. So this is our own: one source of truth for the client ID, the
 * token, and its lifetime.
 */

import { readFile, writeFile } from 'node:fs/promises';

/** Client ID the community wrappers use; the API rejects requests without it. */
export const CLIENT_ID = '6536c228870a3c8857d452e8';

const TOKEN_URL = 'https://graph.tractive.com/4/auth/token';

/**
 * Exchange credentials for a bearer token.
 *
 * There is no refresh token — renewal means doing this again with the
 * password, which is why the service has to keep it available.
 *
 * @param {{email: string, password: string}} credentials
 * @returns {Promise<{token: string, userId: string, expiresAt: number}>}
 */
export async function authenticate({ email, password }) {
    const query = new URLSearchParams({
        grant_type: 'tractive',
        platform_email: email,
        platform_token: password,
    });

    const res = await fetch(`${TOKEN_URL}?${query}`, {
        method: 'POST',
        headers: { 'X-Tractive-Client': CLIENT_ID, 'Content-Type': 'application/json' },
    });

    if (res.status === 429) {
        throw new Error(
            'auth rate limited (HTTP 429). The token endpoint locks out after a ' +
                'handful of logins and sends no Retry-After — wait several minutes. ' +
                'Use session() rather than authenticate() so a cached token is reused.'
        );
    }

    if (!res.ok) {
        throw new Error(`auth failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error(`auth failed: ${JSON.stringify(data)}`);
    }

    return { token: data.access_token, userId: data.user_id, expiresAt: data.expires_at };
}

const CACHE_FILE = '.token.json';

/** Try to renew this long before expiry rather than racing the deadline. */
export const REFRESH_MARGIN_S = 3600;

/**
 * Whether a cached token should be renewed.
 * @param {{expiresAt: number}|null} token
 * @param {number} [now] epoch seconds
 * @returns {boolean}
 */
export function needsRenewal(token, now = Date.now() / 1000) {
    return !token || token.expiresAt - now <= REFRESH_MARGIN_S;
}

/**
 * Whether a cached token is still accepted by the API — true right up to
 * expiry, so a renewal we were rate-limited out of doesn't strand us.
 * @param {{expiresAt: number}|null} token
 * @param {number} [now] epoch seconds
 * @returns {boolean}
 */
export function isUsable(token, now = Date.now() / 1000) {
    return Boolean(token) && token.expiresAt > now;
}

/**
 * A usable token, doing a real login only when there isn't one.
 *
 * Tokens last about two months and there is no refresh token, so the sane
 * lifecycle is: log in once, keep the token, log in again when it runs out.
 * That is not merely an optimisation — the auth endpoint rate-limits hard
 * (HTTP 429, no `Retry-After`, lockouts lasting many minutes), so a process
 * that logs in on every run will lock the account out of the API (**C20**).
 *
 * If renewal is refused while the current token is still valid, the current
 * token is used. Being rate-limited is not a reason to stop working when we
 * already hold something that works.
 *
 * The cache holds a bearer token, so it is gitignored and written 0600.
 *
 * @param {{email: string, password: string}} credentials
 * @returns {Promise<{token: string, userId: string, expiresAt: number}>}
 */
export async function session(credentials) {
    const cached = await readCache();
    if (!needsRenewal(cached)) return cached;

    try {
        const fresh = await authenticate(credentials);
        await writeFile(CACHE_FILE, JSON.stringify(fresh), { mode: 0o600 });
        return fresh;
    } catch (err) {
        if (isUsable(cached)) {
            console.warn(`could not renew token (${err.message}); using the cached one`);
            return cached;
        }
        throw err;
    }
}

/**
 * The cached token, or null when there isn't a readable one.
 * @returns {Promise<{token: string, userId: string, expiresAt: number}|null>}
 */
async function readCache() {
    try {
        const cached = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
        return cached?.token && typeof cached.expiresAt === 'number' ? cached : null;
    } catch {
        return null;
    }
}

/**
 * Headers for an authenticated request.
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function authHeaders(token) {
    return {
        'X-Tractive-Client': CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}
