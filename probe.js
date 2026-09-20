/**
 * Step 1: can we even talk to Tractive?
 *
 * Verifies that the baked-in client ID still works, that email+password auth
 * still gets a token, and that the pet and tracker show up on the account.
 * Prints the IDs the later steps need.
 */
import tractive from 'tractive';

const { TRACTIVE_EMAIL, TRACTIVE_PASSWORD } = process.env;

if (!TRACTIVE_EMAIL || !TRACTIVE_PASSWORD) {
    console.error('Missing TRACTIVE_EMAIL / TRACTIVE_PASSWORD. Copy .env.example to .env and fill it in.');
    process.exit(1);
}

const ok = await tractive.connect(TRACTIVE_EMAIL, TRACTIVE_PASSWORD);
console.log('authenticated:', ok);

if (!ok) {
    console.error('Auth failed. Check the password, or whether the API changed.');
    process.exit(1);
}

console.log('user id:', accountDetails.uid);

const pets = await tractive.getPets();
console.log('\n--- pets (raw) ---');
console.dir(pets, { depth: null });

const trackers = await tractive.getAllTrackers();
console.log('\n--- trackers (raw) ---');
console.dir(trackers, { depth: null });

// The wrapper's list endpoints return stubs; the detail calls have the real data.
for (const { _id } of pets ?? []) {
    const pet = await tractive.getPet(_id);
    console.log(`\n--- pet ${_id} detail ---`);
    console.dir(pet, { depth: null });
}

for (const { _id } of trackers ?? []) {
    const tracker = await tractive.getTracker(_id);
    console.log(`\n--- tracker ${_id} detail ---`);
    console.dir(tracker, { depth: null });
}
