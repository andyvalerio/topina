/**
 * The channel sends partial events (C16) and repeats positions (C18). Both are
 * easy to get wrong in ways that fail silently — a dropped position looks like
 * a quiet cat, and a repeated one divides by a zero interval. These pin the
 * behaviour down without needing the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, merge } from '../../state.js';

test('merge combines nested objects field by field', () => {
    const merged = merge(
        { position: { latlong: [1, 2], speed: 0.5 }, hardware: { battery_level: 87 } },
        { position: { speed: 3.2 } }
    );

    assert.deepEqual(merged.position, { latlong: [1, 2], speed: 3.2 });
    assert.deepEqual(merged.hardware, { battery_level: 87 }, 'untouched keys survive');
});

test('merge replaces arrays rather than blending them', () => {
    const merged = merge({ position: { latlong: [1, 2] } }, { position: { latlong: [3, 4] } });

    assert.deepEqual(merged.position.latlong, [3, 4]);
});

test('merge does not mutate its input', () => {
    const original = { position: { speed: 0.5 } };
    merge(original, { position: { speed: 9 } });

    assert.equal(original.position.speed, 0.5);
});

test('a delta event preserves state it does not mention', () => {
    const tracker = createTracker();

    tracker.apply({
        message: 'tracker_status',
        position: { latlong: [57.7, 12.0], time: 100, speed: 0 },
        hardware: { battery_level: 87 },
    });
    tracker.apply({ message: 'tracker_status', live_tracking: { active: true } });

    const snapshot = tracker.snapshot();
    assert.deepEqual(snapshot.position.latlong, [57.7, 12.0], 'position survived the delta');
    assert.equal(snapshot.hardware.battery_level, 87, 'hardware survived the delta');
    assert.equal(snapshot.live_tracking.active, true);
});

test('a new position is reported once', () => {
    const tracker = createTracker();
    const position = { latlong: [57.7, 12.0], time: 100 };

    assert.equal(tracker.apply({ position })?.time, 100, 'first sighting is a fix');
});

test('a repeated position is not a new fix', () => {
    const tracker = createTracker();
    const position = { latlong: [57.7, 12.0], time: 100 };

    tracker.apply({ position });
    assert.equal(tracker.apply({ position }), null, 'same time is the same fix');
});

test('a position at a new time is a new fix', () => {
    const tracker = createTracker();

    tracker.apply({ position: { latlong: [57.7, 12.0], time: 100 } });
    const fix = tracker.apply({ position: { latlong: [57.8, 12.1], time: 105 } });

    assert.equal(fix?.time, 105);
});

test('events without a position are not fixes', () => {
    const tracker = createTracker();

    assert.equal(tracker.apply({ message: 'keep-alive' }), null);
    assert.equal(tracker.apply({ message: 'tracker_status', hardware: {} }), null);
});
