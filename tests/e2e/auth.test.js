/**
 * Step 1: auth + identify.
 *
 * Guards the assumptions the whole project stands on: that the wrapper's
 * baked-in client ID is still accepted, that email+password auth still mints a
 * token, and that the pet and tracker are reachable on the account.
 *
 * When these break, nothing downstream is worth debugging.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertNotRateLimited,
    connect,
    missingCredentials,
    pets,
    trackers,
    tractive,
} from '../helpers.js';

const skip = missingCredentials;

test('authenticates with email and password', { skip }, async () => {
    assert.equal(await connect(), true, 'connect() should succeed');
    assert.equal(tractive.isAuthenticated(), true);
});

test('authentication yields a user id', { skip }, async () => {
    await connect();
    assert.ok(accountDetails.uid, 'expected a user id on the account details');
});

test('the account has at least one pet', { skip }, async () => {
    const list = await pets();

    assertNotRateLimited(list, 'the pet list');
    assert.ok(Array.isArray(list), 'getPets() should return an array');
    assert.ok(list.length > 0, 'expected a pet on the account');
    assert.ok(list[0]._id, 'expected each pet to carry an _id');
});

test('the account has at least one tracker', { skip }, async () => {
    const list = await trackers();

    assertNotRateLimited(list, 'the tracker list');
    assert.ok(Array.isArray(list), 'getAllTrackers() should return an array');
    assert.ok(list.length > 0, 'expected a tracker on the account');
    assert.ok(list[0]._id, 'expected each tracker to carry an _id');
});

test('pet details identify the pet and carry a home location', { skip }, async () => {
    const [{ _id }] = await pets();
    const pet = await tractive.getPet(_id);

    assertNotRateLimited(pet, `pet ${_id}`);
    assert.ok(pet?.details?.name, 'expected the pet to be named');
    assert.equal(pet.details.pet_type, 'CAT');
    assert.ok(pet.device_id, 'expected the pet to have a tracker attached');

    // home_location is what "distance from home" will be measured against.
    assert.ok(Array.isArray(pet.home_location), 'expected a home location');
    assert.equal(pet.home_location.length, 2, 'expected [lat, long]');
});

test('tracker details report capabilities and state', { skip }, async () => {
    const [{ _id }] = await trackers();
    const tracker = await tractive.getTracker(_id);

    assertNotRateLimited(tracker, `tracker ${_id}`);
    assert.equal(tracker?._id, _id);
    assert.ok(tracker.state, 'expected a tracker state');

    // LT is live tracking — the whole project assumes it's available.
    assert.ok(
        tracker.capabilities?.includes('LT'),
        'expected the tracker to support live tracking'
    );
});
