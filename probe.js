/**
 * Step 1: can we even talk to Tractive?
 *
 * Verifies that the baked-in client ID still works, that email+password auth
 * still gets a token, and that the pet and tracker show up on the account.
 * Prints the IDs the later steps need, so they can go into `.env`.
 */
import { session } from './auth.js';
import * as rest from './rest.js';
import { credentials, missing } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const { token, userId, expiresAt } = await session(credentials);
console.log('authenticated, user id:', userId);
console.log('token expires:', new Date(expiresAt * 1000).toISOString());

const [pets, trackers] = await Promise.all([
    rest.getPets(token, userId),
    rest.getTrackers(token, userId),
]);

console.log('\n--- pets ---');
console.dir(pets, { depth: null });
console.log('\n--- trackers ---');
console.dir(trackers, { depth: null });

// The list endpoints return stubs; the detail calls carry the real payload.
for (const { _id } of pets ?? []) {
    console.log(`\n--- pet ${_id} ---`);
    console.dir(await rest.getPet(token, _id), { depth: null });
}

for (const { _id } of trackers ?? []) {
    console.log(`\n--- tracker ${_id} ---`);
    console.dir(await rest.getTracker(token, _id), { depth: null });
}

console.log('\nPut these into .env as TRACTIVE_PET_ID and TRACTIVE_TRACKER_ID.');
