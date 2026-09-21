/**
 * Knowing whether she is out.
 *
 * A fresh fix during a sample is the best evidence available that she is
 * outside, but it is not proof: a tracker on its charger produces them by the
 * hundred (see docked-hour.test.js). What keeps that from becoming an outing
 * is the docked latch, and what stops one running all day is retraction on
 * stillness. Distance from home still does one job only — telling "walked back
 * indoors" from "lost signal out there".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, dockedNext, initial, step } from '../../outing.js';

const T = 1_000_000_000_000;
const input = (over = {}) => ({
    nowMs: T,
    hour: 12,
    charging: false,
    batteryFull: false,
    freshFix: false,
    distanceM: null,
    movedM: null,
    movedRecentlyM: null,
    stillnessSettled: false,
    holdUntilMs: 0,
    holdLive: null,
    ...over,
});

test('charging means she is indoors — no live, no command', () => {
    const s = step(initial(), input({ charging: true }));

    assert.equal(s.phase, 'docked');
    assert.equal(s.live, false);
});

test('the dock stays latched once charging stops at a full battery', () => {
    // The whole failure of 2026-09-21 in one assertion. The charger reports
    // NOT_CHARGING the moment it reaches 100%, so the old check went blind
    // exactly when the tracker had been sitting on it longest.
    const charging = step(initial(), input({ charging: true }));
    const full = step(charging, input({ nowMs: T + 60_000, charging: false, batteryFull: true }));

    assert.equal(full.phase, 'docked');
    assert.equal(full.docked, true);
    assert.equal(full.live, false);
});

test('only movement opens the latch', () => {
    const docked = step(initial(), input({ charging: true }));

    const jitter = step(docked, input({ nowMs: T + 60_000, movedRecentlyM: 6.5, movedM: 3.5 }));
    assert.equal(jitter.phase, 'docked', 'the worst noise the charger ever produced');

    const carried = step(docked, input({ nowMs: T + 60_000, movedRecentlyM: 25 }));
    assert.notEqual(carried.phase, 'docked', 'someone clipped it back on her');
    assert.equal(carried.docked, false);
});

test('a slow departure opens the latch on the long window', () => {
    // Clipped on, then a wander that never clears 20m in any single minute.
    const docked = step(initial(), input({ charging: true }));
    const s = step(docked, input({ nowMs: T + 60_000, movedRecentlyM: 9, movedM: 18 }));

    assert.equal(s.docked, false);
});

test('an upgrade onto a docked tracker latches it on the first tick', () => {
    // The state this actually shipped onto: written by a version with no
    // latch, so no `docked` key, a non-zero `since`, and a tracker sitting at
    // 100% reporting NOT_CHARGING. Without this the upgrade lands with the
    // latch open on exactly the case it exists to close.
    const stored = { phase: 'waiting', since: 1789971136041, lastFreshFixMs: null, lastDistanceM: 16.5 };

    assert.equal(stored.docked, undefined, 'the state really has no opinion about the dock');
    assert.equal(
        dockedNext(stored, { charging: false, batteryFull: true, movedM: null, movedRecentlyM: null }),
        true
    );
});

test('an upgrade mid-outing does not steal the outing', () => {
    // Same missing key, but she is genuinely out on a full charge. That must
    // stay an outing.
    const stored = { phase: 'out', since: 1789971136041, lastFreshFixMs: 1, lastDistanceM: 40 };

    assert.equal(
        dockedNext(stored, { charging: false, batteryFull: true, movedM: 2, movedRecentlyM: 1 }),
        false
    );
});

test('a full battery latches the dock only from a cold start', () => {
    // Boot onto an already-full docked tracker: the charging transition was
    // never witnessed, so this is the only thing left to notice it.
    assert.equal(dockedNext(initial(), { charging: false, batteryFull: true, movedM: null, movedRecentlyM: null }), true);

    // But she goes out on a full charge all the time, and that must stay an
    // outing — a full battery may never retract one already in progress.
    const out = { phase: 'out', docked: false, since: T };
    assert.equal(dockedNext(out, { charging: false, batteryFull: true, movedM: 2, movedRecentlyM: 1 }), false);
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

test('a manual hold on wins over the dock', () => {
    // If someone asks for live, they get live. It is their call.
    const s = step(initial(), input({ charging: true, holdUntilMs: T + 60_000, holdLive: true }));

    assert.equal(s.live, true);
});

test('half an hour of going nowhere near home ends the outing', () => {
    // The check whose absence held a phantom outing open for a whole morning:
    // the only previous way out of this phase was silence, and a tracker on
    // its charger is not silent.
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 13 }));
    s = step(s, input({ nowMs: T + 1_800_000, freshFix: true, distanceM: 13, movedM: 3.5, stillnessSettled: true }));

    assert.equal(s.phase, 'waiting');
    assert.equal(s.notify, 'still');
    assert.equal(s.live, false);
});

test('stillness never retracts an outing away from home', () => {
    // Out in the field, not moving is at least as likely to mean something is
    // wrong as to mean she is not there. Writing that off is the one error
    // this system must not make.
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 90 }));
    s = step(s, input({ nowMs: T + 1_800_000, freshFix: true, distanceM: 90, movedM: 1, stillnessSettled: true }));

    assert.equal(s.phase, 'out');
    assert.equal(s.live, true);
});

test('stillness waits for the window to fill before retracting anything', () => {
    // Straight after a restart the half-hour window holds two minutes. Acting
    // on that would end an outing on no evidence at all.
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 13 }));
    s = step(s, input({ nowMs: T + 120_000, freshFix: true, distanceM: 13, movedM: 1, stillnessSettled: false }));

    assert.equal(s.phase, 'out');
});

test('a moving cat near home is left alone', () => {
    let s = step(step(initial(), input()), input({ nowMs: T + 9_000, freshFix: true, distanceM: 13 }));
    s = step(s, input({ nowMs: T + 1_800_000, freshFix: true, distanceM: 13, movedM: 12, stillnessSettled: true }));

    assert.equal(s.phase, 'out');
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
