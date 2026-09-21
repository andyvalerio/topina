/**
 * Has it actually gone anywhere?
 *
 * The question path length and speed both get wrong about a stationary
 * tracker. These pin down the two properties the answer depends on: that a
 * single wild fix cannot fake movement, and that real movement is not missed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    centreDisplacement,
    createDisplacement,
    medianCentre,
    REACTION_WINDOW_S,
} from '../../displacement.js';
import { HOME, offset } from '../fixtures/place.js';

/** A fix the window will accept, a given number of metres from home. */
const at = (north, east, time) => ({ latlong: offset(HOME, north, east), time });

/** A tracker sitting still, jittering by a metre or so. */
const still = (count, from = 0) =>
    Array.from({ length: count }, (_, i) =>
        at(Math.sin(i * 1.7) * 1.2, Math.cos(i * 2.3) * 1.2, from + i * 4)
    );

test('a stationary tracker reports going nowhere', () => {
    assert.ok(centreDisplacement(still(15)) < 3);
});

test('too few fixes reports nothing rather than a number it cannot back', () => {
    // Five fixes leaves each half two or three, which is not enough for a
    // median to reject anything. Saying "unknown" is the honest answer, and
    // the callers all treat it as one.
    assert.equal(centreDisplacement(still(5)), null);
    assert.equal(centreDisplacement([]), null);
    assert.ok(centreDisplacement(still(6)) !== null);
});

test('one wild fix cannot fake movement', () => {
    // The charging hour contained a single 49.5m jump. Endpoint-to-endpoint
    // displacement read 52m off it; this must not.
    const fixes = still(15);
    fixes[11] = at(49, 8, fixes[11].time);

    assert.ok(centreDisplacement(fixes) < 5, 'one outlier is not a departure');
});

test('real movement is not missed', () => {
    // Walking away in a straight line, 15 fixes at a metre each.
    const fixes = Array.from({ length: 15 }, (_, i) => at(i * 1.5, 0, i * 4));

    assert.ok(centreDisplacement(fixes) > 8, 'actually went somewhere');
});

test('the median centre ignores an outlier the mean would follow', () => {
    const fixes = [...still(8), at(200, 200, 100)];
    const [lat] = medianCentre(fixes);

    const [homeLat] = HOME;
    const metresNorth = (lat - homeLat) * ((6371000 * Math.PI) / 180);
    assert.ok(Math.abs(metresNorth) < 3);
});

test('the window is trimmed by the tracker clock, not ours', () => {
    // Same reason as signals.js (C14): the span being measured is between
    // fixes, so it must be measured in the clock the fixes carry.
    const window = createDisplacement(60);
    for (const fix of still(30)) window.add(fix);

    const { span, count } = window.value();
    assert.ok(span <= 60, `held ${span}s of history`);
    assert.ok(count < 30, 'older fixes were dropped');
});

test('a window reports itself unsettled until it has filled', () => {
    // Straight after a restart, half an hour of history is two minutes of it.
    // Acting on that would end an outing on no evidence at all.
    const window = createDisplacement(REACTION_WINDOW_S);
    window.add(at(0, 0, 0));
    window.add(at(0, 1, 4));
    assert.equal(window.settled(), false);

    for (const fix of still(15)) window.add(fix);
    assert.equal(window.settled(), true);
});

test('a window can be resized under a running service', () => {
    // Both spans are settings, so both can change while the service is up.
    const window = createDisplacement(600);
    for (const fix of still(60)) window.add(fix);
    assert.ok(window.value().span > 100, 'holding ten minutes of history');

    window.resize(60);
    assert.equal(window.seconds, 60);
    assert.ok(window.value().span <= 60, 'shortening drops what no longer fits at once');
});

test('shortening takes effect without waiting for the next fix', () => {
    // A tracker that has gone quiet may not send one for minutes, and a stale
    // answer over the old span is exactly what a shortened window is not.
    const window = createDisplacement(600);
    for (const fix of still(60)) window.add(fix);
    const before = window.value().count;

    window.resize(60);
    assert.ok(window.value().count < before);
});

test('a nonsense resize is ignored rather than breaking the window', () => {
    const window = createDisplacement(60);
    for (const fix of still(15)) window.add(fix);

    for (const bad of [0, -60, NaN, null, undefined]) window.resize(bad);
    assert.equal(window.seconds, 60);
    assert.ok(window.value().displacementM !== null, 'still answering');
});
