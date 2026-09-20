/**
 * Install a bearer token without logging in.
 *
 * The auth endpoint locks out after a handful of logins (**C20**) and sends no
 * `Retry-After`, which can leave you unable to authenticate for a long while.
 * Tokens themselves are unaffected and last about two months, so a token
 * obtained anywhere else works immediately.
 *
 * To get one: open my.tractive.com, DevTools → Network, pick any request, and
 * copy the value of its `Authorization: Bearer <token>` header.
 *
 *   npm run token -- <token> [userId]
 *
 * The token is verified against a real endpoint before being written, so a
 * mistyped paste fails here rather than three steps later.
 */
import { writeFile } from 'node:fs/promises';
import * as rest from './rest.js';
import { missing, trackerId, userId as configuredUserId } from './config.js';

const [token, userIdArg] = process.argv.slice(2);

if (!token) {
    console.error('usage: npm run token -- <bearer-token> [userId]');
    console.error('get one from my.tractive.com → DevTools → Network → Authorization header');
    process.exit(1);
}

const blocked = missing('TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(`${blocked} — needed to verify the token`);
    process.exit(1);
}

const tracker = await rest.getTracker(token, trackerId);

if (rest.isRateLimited(tracker)) {
    console.error('rate limited while verifying — wait a minute and try again');
    process.exit(1);
}

if (tracker?._id !== trackerId) {
    console.error('that token did not work:', JSON.stringify(tracker).slice(0, 200));
    process.exit(1);
}

// A hand-supplied token carries no stated expiry. Assume a conservative one:
// if it turns out to be wrong the channel gets a 401 and re-authenticates,
// which by then will no longer be rate-limited.
const ASSUMED_LIFETIME_S = 86400 * 30;
const expiresAt = Math.floor(Date.now() / 1000) + ASSUMED_LIFETIME_S;

await writeFile(
    '.token.json',
    JSON.stringify({ token, userId: userIdArg || configuredUserId, expiresAt }),
    { mode: 0o600 }
);

console.log(`verified against tracker ${tracker._id} (${tracker.state})`);
console.log(`written to .token.json, assumed good until ${new Date(expiresAt * 1000).toISOString()}`);
if (!userIdArg && !configuredUserId) {
    console.log('no user id: account-wide list endpoints will not work until one is set');
}
