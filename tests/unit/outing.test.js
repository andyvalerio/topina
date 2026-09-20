/**
 * Knowing whether she is out.
 *
 * The discriminator is not geometry: indoors, live tracking produces no fresh
 * fixes at all, outdoors it produces one every four seconds. So a fresh fix
 * during a sample means she is outside. Distance from home is used for one
 * job only — telling "walked back indoors" from "lost signal out there".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, initial, step } from '../../outing.js';

const T = 1_000_000_000_000;
const input = (over = {}) => ({
    nowMs: T,
    hour: 12,
    charging: false,
    freshFix: false,
    distanceM: null,
    holdUntilMs: 0,
    holdLive: null,
    ...over,
});

test('charging means she is indoors — no live, no command', () => {
    const s = step(initial(), input({ charging: true }));

    assert.equal(s.phase, 'charging');
    assert.equal(s.live, false);
});

test('outside the active window nothing happens', () => {
    // She is never out at night; sampling then would be pure battery waste.
    assert.equal(step(initial(), input({ hour: 3 })).phase, 'off-hours');
    assert.equal(step(initial(), input({ hour: 22 })).live, false);
});

test('the window boundaries are inclusive at the start, exclusive at the end', () => {
    assert.notEqual(step(initial(), input({ hour: 7 })).phase, 'off-hours');
    assert.equal(step(initial(), input({ hour: 17 })).phase, 'off-hours');
});

test('a sample turns live on', () => {
    const s = step(initial(), input());

    assert.equal(s.phase, 'sampling');
    assert.equal(s.live, true);
});

test('a fresh fix during a sample means she is out', () => {
    // The whole discriminator, in one assertion.
    const sampling = step(initial(), input());
    const s = step(sampling, input({ nowMs: T + 9_000, freshFix: true, distanceM: 15 }));

    assert.equal(s.phase, 'out');
    assert.equal(s.notify, 'out');
    assert.equal(s.live, true);
});

test('a sample with no fresh fix means she is indoors', () => {
    const sampling = step(initial(), input());
    const s = step(sampling, input({ nowMs: T + DEFAULTS.sampleDurationS * 1000 }));

    assert.equal(s.phase, 'waiting');
    assert.equal(s.live, false, 'stop burning battery');
    assert.equal(s.notify, null, 'a cat indoors is not news');
});

test('a sample is given its full length before giving up', () => {
    const sampling = step(initial(), input());
    const s = step(sampling, input({ nowMs: T + 5_000 }));

    assert.equal(s.phase, 'sampling', 'five seconds is not long enough to conclude');
});

test('while she is out, live stays on and nothing is announced', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 15 }));
    s = step(s, input({ nowMs: T + 13_000, freshFix: true, distanceM: 20 }));

    assert.equal(s.phase, 'out');
    assert.equal(s.live, true);
    assert.equal(s.notify, null, 'do not re-announce every four seconds');
});

test('no sampling cycle runs while she is out', () => {
    // Toggling live off mid-outing would be the worst possible moment.
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 15 }));
    s = step(s, input({ nowMs: T + 60_000, freshFix: true, distanceM: 30 }));

    assert.equal(s.live, true);
});

test('fixes stopping near home means she came in', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 8 }));
    s = step(s, input({ nowMs: T + 9_000 + DEFAULTS.quietS * 1000 }));

    assert.equal(s.phase, 'waiting');
    assert.equal(s.notify, 'home');
    assert.equal(s.live, false);
});

test('fixes stopping far from home means lost signal, not home', () => {
    // Under a car or deep in a hedge. This is the moment worth hearing about,
    // and announcing "she's back" here would be actively dangerous.
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 90 }));
    s = step(s, input({ nowMs: T + 9_000 + DEFAULTS.quietS * 1000 }));

    assert.equal(s.phase, 'signal-lost');
    assert.equal(s.notify, 'signal-lost');
    assert.equal(s.live, true, 'keep looking for her');
});

test('a short quiet spell while out is not a homecoming', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 8 }));
    s = step(s, input({ nowMs: T + 20_000 }));

    assert.equal(s.phase, 'out', 'a pause under a bush is not going indoors');
});

test('signal coming back is announced and returns to out', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 90 }));
    s = step(s, input({ nowMs: T + 9_000 + DEFAULTS.quietS * 1000 }));
    s = step(s, input({ nowMs: T + 400_000, freshFix: true, distanceM: 85 }));

    assert.equal(s.phase, 'out');
    assert.equal(s.notify, 'signal-back');
});

test('a manual hold on wins over the charging check', () => {
    // If someone asks for live, they get live. It is their call.
    const s = step(initial(), input({ charging: true, holdUntilMs: T + 60_000, holdLive: true }));

    assert.equal(s.live, true);
});

test('a manual hold off wins while she is out', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 15 }));
    s = step(s, input({ nowMs: T + 10_000, holdUntilMs: T + 600_000, holdLive: false }));

    assert.equal(s.live, false);
});

test('an expired hold hands control back to automatic', () => {
    const s = step(initial(), input({ nowMs: T + 61_000, holdUntilMs: T + 60_000, holdLive: false }));

    assert.equal(s.phase, 'sampling', 'back to sampling on its own');
});

test('the first sample runs immediately on startup', () => {
    // On start we have no idea where she is, which is exactly when to look.
    assert.equal(step(initial(), input()).phase, 'sampling');
});
