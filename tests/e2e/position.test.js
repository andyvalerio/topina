/**
 * Step 2: one-shot position.
 *
 * The position report is the raw material for every derived signal, so these
 * tests pin down the fields the detectors will read and the ranges they must
 * be in. They assert shape, not values — coordinates and battery move, field
 * names shouldn't.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNotRateLimited, missingCredentials, session } from '../helpers.js';
import * as rest from '../../rest.js';
import { missing, trackerId } from '../../config.js';

const skip = missingCredentials || missing('TRACTIVE_TRACKER_ID');

/** One call, shared: `device_pos_report` is rate-limited like everything else. */
let cached;
const report = async () => {
    const { token } = await session();
    cached ??= await rest.getPosition(token, trackerId);
    assertNotRateLimited(cached, 'the position report');
    return cached;
};

test('the tracker reports a plausible position', { skip }, async () => {
    const { latlong } = await report();

    assert.ok(Array.isArray(latlong), 'expected a latlong pair');
    const [latitude, longitude] = latlong;
    assert.equal(typeof latitude, 'number');
    assert.equal(typeof longitude, 'number');
    assert.ok(latitude >= -90 && latitude <= 90, `latitude out of range: ${latitude}`);
    assert.ok(longitude >= -180 && longitude <= 180, `longitude out of range: ${longitude}`);
});

test('the position report is timestamped in seconds', { skip }, async () => {
    const { time } = await report();

    assert.equal(typeof time, 'number');

    // Guards against a silent switch to milliseconds, which would make every
    // staleness and speed calculation nonsense.
    const ageSeconds = Date.now() / 1000 - time;
    assert.ok(ageSeconds > -60, `timestamp is in the future by ${-ageSeconds}s`);
    assert.ok(ageSeconds < 86400 * 7, `timestamp looks like the wrong unit: ${time}`);
});

test('the report carries the fields the detectors need', { skip }, async () => {
    const fix = await report();

    // speed is optional: the REST report carries it when the last fix came
    // from normal reporting, but mirrors a live fix — which has none — after
    // live tracking has run. Derived speed is what detectors actually use.
    if (fix.speed !== undefined) {
        assert.equal(typeof fix.speed, 'number', 'speed, when present, must be a number');
    }
    assert.equal(typeof fix.altitude, 'number');
    assert.equal(typeof fix.sensor_used, 'string');

    // Named pos_uncertainty on REST; the channel calls the same thing accuracy.
    assert.equal(typeof fix.pos_uncertainty, 'number');
    assert.ok(fix.pos_uncertainty >= 0, 'accuracy cannot be negative');
});

test('a position reverse-geocodes to an address', { skip }, async () => {
    const { token } = await session();
    const { latlong } = await report();
    const address = await rest.getAddress(token, latlong);

    // Not needed for detection, but it's free context when an alert fires.
    assertNotRateLimited(address, 'the address');
    assert.equal(typeof address.full_address, 'string');
});
