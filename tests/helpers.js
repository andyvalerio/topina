/**
 * Shared helpers for end-to-end tests.
 *
 * E2E tests here hit the real Tractive API — there is no mock, and mocking an
 * undocumented API we don't understand yet would only test our assumptions
 * about it. That means they need real credentials and a network connection,
 * and they skip rather than fail when either is missing.
 *
 * The API rate-limits *per resource* after roughly two calls in quick
 * succession, so everything here is fetched at most once per run. Tests must
 * never call the same endpoint twice.
 */
import { session as authSession } from '../auth.js';
import { isRateLimited } from '../rest.js';
import { credentials, missing } from '../config.js';

/** Reason string when credentials are absent, or false when we're good to go. */
export const missingCredentials = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD');

/**
 * Assert a response isn't a rate-limit error, with a message that says what to
 * do about it. Rate limiting is a flaky-test cause, not a product bug.
 * @param {unknown} response
 * @param {string} what
 */
export function assertNotRateLimited(response, what) {
    if (isRateLimited(response)) {
        throw new Error(
            `rate limited fetching ${what} — wait a minute and re-run. ` +
                'If this is persistent, a test is calling the same endpoint twice.'
        );
    }
}

/** Memoised so repeated access across tests costs one request each. */
const once = (fn) => {
    let promise;
    return () => (promise ??= fn());
};

export const session = once(() => authSession(credentials));
