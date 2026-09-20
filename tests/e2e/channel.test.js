/**
 * Step 3: the push channel.
 *
 * The channel is the only viable live feed — REST rate-limits after a couple
 * of calls — so these tests guard the connection itself and the shape of the
 * snapshot it opens with. If this file goes red, the project has no live data.
 *
 * One connection is shared across the tests: opening several channels to watch
 * the same tracker is rude and slow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { listen, HEARTBEAT_MESSAGES } from '../../channel.js';
import { credentials, missing } from '../../config.js';
import { missingCredentials } from '../helpers.js';

const skip = missingCredentials;

/** Long enough for the handshake, the opening snapshot, and two keep-alives. */
const WINDOW_MS = 13_000;

let collected;

/**
 * Hold the channel open briefly and gather everything it sends.
 * @returns {Promise<object[]>}
 */
function messages() {
    collected ??= (async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), WINDOW_MS).unref();

        const received = [];
        try {
            for await (const event of listen(credentials, { signal: controller.signal })) {
                received.push(event);
            }
        } catch (err) {
            if (err.name !== 'AbortError') throw err;
        }
        return received;
    })();
    return collected;
}

test('the channel opens and sends messages', { skip }, async () => {
    const received = await messages();

    assert.ok(received.length > 0, 'the channel sent nothing at all');
    assert.ok(
        received.every((event) => typeof event.message === 'string'),
        'every channel event should carry a message type'
    );
});

test('the connection is held open with heartbeats', { skip }, async () => {
    const received = await messages();
    const heartbeats = received.filter((event) => HEARTBEAT_MESSAGES.has(event.message));

    // Observed cadence is one keep-alive every 5s; two proves it's sustained
    // rather than a single greeting.
    assert.ok(heartbeats.length >= 2, `expected sustained heartbeats, got ${heartbeats.length}`);
});

test('the opening snapshot describes the tracker', { skip }, async () => {
    const received = await messages();
    const status = received.find((event) => event.message === 'tracker_status');

    assert.ok(status, 'expected a tracker_status snapshot on connect');
    assert.equal(typeof status.tracker_id, 'string');
    assert.equal(typeof status.tracker_state, 'string');
    assert.equal(typeof status.charging_state, 'string');
});

test('the snapshot carries a position with channel field names', { skip }, async () => {
    const { position } = (await messages()).find((event) => event.message === 'tracker_status');

    assert.ok(Array.isArray(position?.latlong), 'expected a latlong pair');
    assert.equal(typeof position.time, 'number');

    // The channel says `accuracy` where the REST report says `pos_uncertainty`.
    // If this ever flips, every detector reading both silently breaks.
    assert.equal(typeof position.accuracy, 'number', 'channel position should use `accuracy`');
    assert.equal(position.pos_uncertainty, undefined, 'channel should not use `pos_uncertainty`');

    // time_rcvd is the server's clock, time is the tracker's, and they are NOT
    // the same clock — time_rcvd has been observed 7s *behind* time. They stay
    // in the same ballpark, which is all we can assert (C14).
    assert.equal(typeof position.time_rcvd, 'number');
    const skew = Math.abs(position.time_rcvd - position.time);
    assert.ok(skew < 86400, `time and time_rcvd disagree by ${skew}s`);
});

test('the snapshot reports hardware and control state', { skip }, async () => {
    const status = (await messages()).find((event) => event.message === 'tracker_status');

    assert.equal(typeof status.hardware?.battery_level, 'number');

    // live_tracking.remaining counts down the device-level LT timeout.
    for (const control of ['led_control', 'buzzer_control', 'live_tracking']) {
        assert.equal(typeof status[control]?.active, 'boolean', `${control}.active`);
        assert.equal(typeof status[control]?.remaining, 'number', `${control}.remaining`);
    }
});
