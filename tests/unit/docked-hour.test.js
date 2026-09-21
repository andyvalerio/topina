/**
 * The morning the monitor watched a charger.
 *
 * On 2026-09-21 the tracker sat on its charging dock from before 07:00. At
 * 07:00:00 the active window opened, at 07:00:10 a fresh GPS fix arrived, and
 * the service announced an outing and pinned live tracking on. It stayed
 * "out" for the whole hour, announced a second outing at 07:21 ten seconds
 * after a manual hold was cleared, raised three alarms, and drained the
 * battery from 100% to 96% while sitting on the charger.
 *
 * `docked-hour.jsonl` is that hour, exported from the running service. It is
 * the only known-bad case this project has, and every assertion below is a
 * thing that actually happened. If these fail, it can happen again.
 *
 * The fixture is committed deliberately, against the repo's own `*.jsonl`
 * ignore rule. Regenerating it is not possible — it needs that morning.
 *
 * Its coordinates are **translated onto the fictional home** in place.js, by
 * one constant offset applied to every position. Every distance, displacement
 * and ratio below is therefore exactly what the real hour produced, while the
 * house stays out of a public repo (**G3**). Nothing here is geography; all of
 * it is geometry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSignals, createWindow } from '../../signals.js';
import { createDetector } from '../../detectors.js';
import { createDisplacement, REACTION_WINDOW_S, STILLNESS_WINDOW_S } from '../../displacement.js';
import { DEFAULTS as OUTING, initial, step } from '../../outing.js';

const rows = readFileSync(new URL('../fixtures/docked-hour.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

/** The fixes as the pipeline sees them, with the arrival time they came with. */
const fixes = rows
    .filter((r) => r.kind === 'fix' && r.data?.latlong)
    .map((r) => ({
        receivedMs: r.ts,
        latlong: r.data.latlong,
        time: r.data.time,
        accuracy: r.data.accuracy,
        sensor_used: r.data.sensor,
        fromHome: r.data.fromHome,
    }));

test('the fixture is the hour it claims to be', () => {
    assert.equal(fixes.length, 747, 'an hour of fixes from a tracker going nowhere');
    assert.equal(rows.filter((r) => r.kind === 'notify' && r.data.kind === 'out').length, 2,
        'it announced two separate outings');
    assert.equal(rows.filter((r) => r.kind === 'fix' && r.data.level === 'alarm').length, 3,
        'and raised three alarms doing it');
});

test('the 11.54 m/s sprint that never happened is rejected outright', () => {
    // A cat cannot run at 11.5 m/s and stay where she is. This one came off a
    // single 49m outlier fix on a window of three, and the displacement gate
    // is what refuses it.
    const window = createWindow();
    const detector = createDetector();
    const sprints = [];

    for (const fix of fixes) {
        const signals = computeSignals({
            fix,
            window: window.add(fix),
            lastArrivalMs: fix.receivedMs,
            nowMs: fix.receivedMs,
        });
        for (const f of detector.assess(signals).findings) {
            if (f.code === 'sprint') sprints.push(f.detail);
        }
    }

    assert.deepEqual(sprints, [], `still calling this a sprint: ${sprints.join(', ')}`);
});

test('thrash still fires on this hour, and is meant to', () => {
    // Worth an assertion precisely because it looks like a failure. A fight
    // is two cats going nowhere hard, so a detector that ignored findings
    // with no displacement would be blind to the thing this project exists
    // for. Multipath and a scuffle are genuinely indistinguishable here — so
    // the answer is not to weaken the detector, it is to stop feeding it a
    // tracker that is not on the cat. That is the next test.
    const window = createWindow();
    const detector = createDetector();
    let thrash = 0;

    for (const fix of fixes) {
        const signals = computeSignals({
            fix,
            window: window.add(fix),
            lastArrivalMs: fix.receivedMs,
            nowMs: fix.receivedMs,
        });
        thrash += detector.assess(signals).findings.filter((f) => f.code === 'thrash').length;
    }

    assert.ok(thrash > 0, 'if this ever reaches zero, check why before celebrating');
});

test('nothing is judged at all while the tracker is on its dock', () => {
    // What server.js does with a docked latch, and the assertion that carries
    // the real weight: the detectors never see a fix from a tracker that is
    // not on her, so none of this hour can produce a finding of any kind.
    const window = createWindow();
    const detector = createDetector();
    const docked = true;
    const raised = [];

    for (const fix of fixes) {
        const signals = computeSignals({
            fix,
            window: window.add(fix),
            lastArrivalMs: fix.receivedMs,
            nowMs: fix.receivedMs,
        });
        const verdict = docked ? { findings: [] } : detector.assess(signals);
        for (const f of verdict.findings) raised.push(f.code);
    }

    assert.deepEqual(raised, [], 'a charger cannot be in trouble');
});

test('accumulated path says it moved; displacement says it did not', () => {
    // Both numbers come out of the same fixes. This is why the detectors are
    // gated on the second one and not the first.
    const window = createWindow();
    let path = 0;
    let worstDisplacement = 0;

    for (const fix of fixes) {
        const signals = computeSignals({
            fix,
            window: window.add(fix),
            lastArrivalMs: fix.receivedMs,
            nowMs: fix.receivedMs,
        });
        path += signals.moved ?? 0;
        if (signals.displacementM !== null) {
            worstDisplacement = Math.max(worstDisplacement, signals.displacementM);
        }
    }

    assert.ok(path > 350, `accumulated ${path.toFixed(0)}m of path going nowhere`);
    assert.ok(
        worstDisplacement <= 7,
        `centre never moved more than 7m over a minute, got ${worstDisplacement.toFixed(1)}m`
    );
});

test('a single 49m outlier fix does not register as movement', () => {
    // Endpoint-to-endpoint displacement peaked at 52m over this hour, which is
    // why the median of each half is used instead.
    const jump = fixes.reduce((worst, fix, i) => {
        if (i === 0) return worst;
        const a = fixes[i - 1].latlong;
        const b = fix.latlong;
        const d = Math.hypot((b[0] - a[0]) * 111_320, (b[1] - a[1]) * 111_320 * Math.cos((b[0] * Math.PI) / 180));
        return Math.max(worst, d);
    }, 0);

    assert.ok(jump > 40, `the hour really does contain a ${jump.toFixed(0)}m jump`);

    const displacement = createDisplacement(REACTION_WINDOW_S);
    let worst = 0;
    for (const fix of fixes) {
        const { displacementM } = displacement.add(fix);
        if (displacementM !== null) worst = Math.max(worst, displacementM);
    }

    assert.ok(worst < 10, `and it survives it: worst reading ${worst.toFixed(1)}m`);
});

test('a latched dock is never talked out of it by an hour of fixes', () => {
    // The tracker was charging before the window opened. From there, nothing
    // in this hour is allowed to produce an outing.
    const reaction = createDisplacement(REACTION_WINDOW_S);
    const stillness = createDisplacement(STILLNESS_WINDOW_S);

    let state = step(initial(), {
        nowMs: fixes[0].receivedMs - 1000,
        hour: 6,
        charging: true,
        batteryFull: false,
        freshFix: false,
        distanceM: null,
        movedM: null,
        movedRecentlyM: null,
        stillnessSettled: false,
        holdUntilMs: 0,
        holdLive: null,
    });
    assert.equal(state.docked, true, 'latched while charging');

    const phases = new Set();
    for (const fix of fixes) {
        const recent = reaction.add(fix);
        const drift = stillness.add(fix);
        state = step(state, {
            nowMs: fix.receivedMs,
            hour: 7,
            // Charging stopped once the battery hit 100% — the blind spot.
            charging: false,
            batteryFull: true,
            freshFix: true,
            distanceM: fix.fromHome,
            movedM: drift.displacementM,
            movedRecentlyM: recent.displacementM,
            stillnessSettled: stillness.settled(),
            holdUntilMs: 0,
            holdLive: null,
        });
        phases.add(state.phase);
        assert.equal(state.live, false, `live tracking turned on at ${new Date(fix.receivedMs).toISOString()}`);
    }

    assert.deepEqual([...phases], ['docked'], 'it never left the dock');
});

test('even with the latch open, the outing is retracted inside half an hour', () => {
    // The backstop, for every way the latch could be wrong: a service that
    // restarted mid-hour, a dock that was never seen charging, a battery read
    // that never arrived. The outing may start. It may not run all morning.
    const stillness = createDisplacement(STILLNESS_WINDOW_S);

    let state = { ...initial(), phase: 'out', since: fixes[0].receivedMs, docked: false,
        lastFreshFixMs: fixes[0].receivedMs, lastDistanceM: fixes[0].fromHome };
    let retractedAt = null;

    for (const fix of fixes) {
        const drift = stillness.add(fix);
        state = step(state, {
            nowMs: fix.receivedMs,
            hour: 7,
            charging: false,
            batteryFull: false,
            freshFix: true,
            distanceM: fix.fromHome,
            movedM: drift.displacementM,
            movedRecentlyM: null,
            stillnessSettled: stillness.settled(),
            holdUntilMs: 0,
            holdLive: null,
        });
        if (state.notify === 'still') {
            retractedAt = fix.receivedMs;
            break;
        }
    }

    assert.ok(retractedAt !== null, 'the outing was never retracted');
    const minutes = (retractedAt - fixes[0].receivedMs) / 60_000;
    assert.ok(minutes <= 35, `retracted after ${minutes.toFixed(0)} minutes`);
    assert.equal(state.live, false, 'and live tracking went off with it');
});

test('the retraction is bounded by the home radius, and this hour was inside it', () => {
    // If it had not been, the retraction would correctly have refused to fire.
    const far = fixes.filter((f) => f.fromHome > OUTING.homeRadiusM).length;
    assert.ok(far / fixes.length < 0.05, `${far} of ${fixes.length} fixes strayed past the home radius`);
});
