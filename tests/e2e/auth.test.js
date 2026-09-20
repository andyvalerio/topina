/**
 * Step 1: auth + identify.
 *
 * Guards the assumptions the whole project stands on: that the baked-in client
 * ID is still accepted, that email+password auth still mints a token, and that
 * the pet and tracker are reachable on the account.
 *
 * When these break, nothing downstream is worth debugging.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotRateLimited, missingCredentials, session } from '../helpers.js';
import * as rest from '../../rest.js';
import { missing, petId, trackerId } from '../../config.js';

const skip = missingCredentials;
const withIds = skip || missing('TRACTIVE_PET_ID', 'TRACTIVE_TRACKER_ID');

test('authenticates with email and password', { skip }, async () => {
    const { token, userId } = await session();

    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0, 'expected a bearer token');
    assert.ok(userId, 'expected a user id');
});

test('the token carries an expiry well into the future', { skip }, async () => {
    const { expiresAt } = await session();

    assert.equal(typeof expiresAt, 'number');

    // There is no refresh token, so the service re-authenticates with the
    // password before this passes. Knowing the horizon is roughly months
    // rather than minutes is what makes that design safe.
    const daysLeft = (expiresAt - Date.now() / 1000) / 86400;
    assert.ok(daysLeft > 1, `token expires in ${daysLeft.toFixed(1)} days`);
});

test('the account lists a pet and a tracker', { skip }, async () => {
    const { token, userId } = await session();
    const [pets, trackers] = await Promise.all([
        rest.getPets(token, userId),
        rest.getTrackers(token, userId),
    ]);

    assertNotRateLimited(pets, 'the pet list');
    assertNotRateLimited(trackers, 'the tracker list');
    assert.ok(Array.isArray(pets) && pets.length > 0, 'expected a pet on the account');
    assert.ok(Array.isArray(trackers) && trackers.length > 0, 'expected a tracker');
    assert.ok(pets[0]._id && trackers[0]._id, 'expected ids on both');
});

test('pet details identify the pet and carry a home location', { skip: withIds }, async () => {
    const { token } = await session();
    const pet = await rest.getPet(token, petId);

    assertNotRateLimited(pet, 'the pet');
    assert.ok(pet?.details?.name, 'expected the pet to be named');
    assert.equal(pet.details.pet_type, 'CAT');
    assert.ok(pet.device_id, 'expected a tracker attached');

    // home_location is what "distance from home" is measured against.
    assert.ok(Array.isArray(pet.home_location), 'expected a home location');
    assert.equal(pet.home_location.length, 2, 'expected [lat, long]');
});

test('tracker details report capabilities and state', { skip: withIds }, async () => {
    const { token } = await session();
    const tracker = await rest.getTracker(token, trackerId);

    assertNotRateLimited(tracker, 'the tracker');
    assert.equal(tracker?._id, trackerId);
    assert.ok(tracker.state, 'expected a tracker state');

    // LT is live tracking — the whole project assumes it is available.
    assert.ok(tracker.capabilities?.includes('LT'), 'expected live tracking support');
});
