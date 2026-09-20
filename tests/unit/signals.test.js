/**
 * The signal maths.
 *
 * These are the numbers every later decision rests on, and they fail quietly:
 * a speed that is silently null reads as a calm cat, and a thrash ratio that
 * divides by noise reads as a crisis. Reference values come from the measured
 * walk — still never exceeded 0.23 m/s, walking ran ~1.0 m/s.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindow, computeSignals, speedBetween, staleness, thrashRatio } from '../../signals.js';

/** ~0.00001 degrees of latitude is about 1.1m. */
const at = (metresNorth, time) => ({
    latlong: [57.761 + metresNorth * 0.000009, 12.0646],
    time,
});

test('speed is distance over the tracker-clock interval', () => {
    const speed = speedBetween(at(0, 100), at(4, 104));

    assert.ok(Math.abs(speed - 1) < 0.1, `expected ~1 m/s, got ${speed}`);
});

test('a repeated fix yields no speed rather than infinity', () => {
    // Positions repeat with an identical time (C18). Dividing by that
    // interval would produce Infinity and poison everything downstream.
    assert.equal(speedBetween(at(0, 100), at(5, 100)), null);
});

test('a fix out of order yields no speed', () => {
    assert.equal(speedBetween(at(0, 104), at(5, 100)), null);
});

test('walking in a line barely thrashes', () => {
    const fixes = [at(0, 100), at(4, 104), at(8, 108), at(12, 112)];

    const ratio = thrashRatio(fixes);
    assert.ok(ratio < 1.1, `a straight line should be ~1, got ${ratio}`);
});

test('back-and-forth movement thrashes hard', () => {
    // Covers ground, arrives nowhere — the shape of a scuffle.
    const fixes = [at(0, 100), at(10, 104), at(0, 108), at(10, 112), at(1, 116)];

    const ratio = thrashRatio(fixes);
    assert.ok(ratio > 3, `expected a high ratio, got ${ratio}`);
});

test('thrash is not computed from noise', () => {
    // A stationary tracker jitters sub-metre. Dividing that by itself would
    // manufacture a dramatic ratio out of nothing.
    const jitter = [at(0, 100), at(0.3, 104), at(0.1, 108), at(0.2, 112)];

    assert.equal(thrashRatio(jitter), null);
});

test('a long stationary window does not read as thrashing', () => {
    // The failure replay caught: over 60s of standing still, sub-metre jitter
    // accumulates several metres of path while net displacement stays small,
    // scoring higher than an actual walk. Standing still must report nothing.
    const still = [];
    for (let i = 0; i <= 15; i++) {
        still.push(at((i % 2) * 0.5, 100 + i * 4));
    }

    assert.equal(thrashRatio(still), null, 'jitter over a long window is still jitter');
});

test('thrash reports once movement clears the noise floor', () => {
    // Same back-and-forth, but at walking pace rather than jitter.
    const fixes = [at(0, 100), at(8, 104), at(0, 108), at(8, 112), at(1, 116)];

    assert.ok(thrashRatio(fixes) > 2, 'real movement going nowhere should score');
});

test('thrash needs enough fixes to mean anything', () => {
    assert.equal(thrashRatio([at(0, 100), at(5, 104)]), null);
});

test('staleness counts seconds on our clock', () => {
    assert.equal(staleness(1_000_000_000_000, 1_000_000_030_000), 30);
});

test('staleness never goes negative', () => {
    // Clocks jump; a negative age would read as fresher than fresh.
    assert.equal(staleness(1_000_000_030_000, 1_000_000_000_000), 0);
});

test('the window drops fixes older than its span', () => {
    const window = createWindow(60);

    window.add(at(0, 100));
    window.add(at(1, 130));
    const fixes = window.add(at(2, 200));

    assert.equal(fixes.length, 1, 'only the newest fix is within 60s of t=200');
    assert.equal(fixes[0].time, 200);
});

test('the window keeps fixes exactly on the boundary', () => {
    const window = createWindow(60);

    window.add(at(0, 100));
    const fixes = window.add(at(1, 160));

    assert.equal(fixes.length, 2, '60s old is still within a 60s window');
});

test('the first fix has no speed but still reports staleness', () => {
    const signals = computeSignals({
        fix: at(0, 100),
        window: [at(0, 100)],
        lastArrivalMs: 1_000_000_000_000,
        nowMs: 1_000_000_005_000,
    });

    assert.equal(signals.speed, null, 'nothing to measure against yet');
    assert.equal(signals.staleness, 5);
});

test('signals combine into one reading', () => {
    const window = [at(0, 100), at(4, 104), at(8, 108)];
    const signals = computeSignals({
        fix: window.at(-1),
        window,
        home: [57.761, 12.0646],
        lastArrivalMs: 1_000_000_000_000,
        nowMs: 1_000_000_000_000,
    });

    assert.ok(Math.abs(signals.speed - 1) < 0.1, 'about 1 m/s');
    assert.ok(Math.abs(signals.moved - 4.4) < 0.6, 'about 4m between fixes');
    assert.equal(signals.interval, 4);
    assert.ok(signals.fromHome > 8, 'walked away from home');
});
