/**
 * What counts as trouble.
 *
 * Two failure modes, and they are not symmetric: missing a real fight is the
 * one that matters, but an alarm that cries wolf gets ignored and then misses
 * the real fight too. These pin down both directions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, DEFAULTS, findings, worst } from '../../detectors.js';

/** A reading of a calm cat: the measured standing-still profile. */
const calm = {
    speed: 0.15,
    thrash: null,
    staleness: 4,
    fromHome: 20,
    sensor: 'GPS',
};

const reading = (overrides) => ({ ...calm, ...overrides });

test('a calm cat produces no findings', () => {
    assert.deepEqual(findings(calm), []);
});

test('walking is not a finding', () => {
    // Measured at ~1.0 m/s. If walking alarmed, the alarm would be useless.
    assert.deepEqual(findings(reading({ speed: 1.0, thrash: 1.3 })), []);
});

test('jogging pace is still not a sprint', () => {
    // The fastest thing we have actually measured, 1.58 m/s, must stay quiet.
    assert.deepEqual(findings(reading({ speed: 1.58 })), []);
});

test('a sprint is an alarm', () => {
    const found = findings(reading({ speed: 3.5 }));

    assert.equal(found.length, 1);
    assert.equal(found[0].code, 'sprint');
    assert.equal(found[0].level, 'alarm');
});

test('thrashing is an alarm', () => {
    const found = findings(reading({ speed: 1.2, thrash: 6 }));

    assert.equal(found[0].code, 'thrash');
    assert.equal(found[0].level, 'alarm');
});

test('thrash does not alarm once movement has stopped', () => {
    // The failure replay caught: thrash is windowed, so its ratio stays high
    // for a minute after the movement ends. Standing still must read calm
    // even while the window still remembers a sprint.
    assert.deepEqual(findings(reading({ speed: 0.06, thrash: 15 })), []);
});

test('thrash alarms while the movement is still happening', () => {
    const found = findings(reading({ speed: 1.5, thrash: 8 }));

    assert.equal(found[0].code, 'thrash');
});

test('a suppressed thrash ratio cannot alarm', () => {
    // Thrash reads null when stationary; null must never compare as high.
    assert.deepEqual(findings(reading({ thrash: null })), []);
});

test('silence is an alarm', () => {
    const found = findings(reading({ staleness: 120 }));

    assert.equal(found[0].code, 'silence');
    assert.equal(found[0].level, 'alarm');
});

test('silence fires even when there is nothing else to measure', () => {
    // The dead-man case: no fix has arrived, so speed and thrash are null.
    const found = findings({ speed: null, thrash: null, staleness: 300, fromHome: null, sensor: null });

    assert.equal(found.length, 1);
    assert.equal(found[0].code, 'silence');
});

test('losing GPS is elevated, not an alarm', () => {
    const found = findings(reading({ sensor: 'CELL' }));

    assert.equal(found[0].code, 'no-gps');
    assert.equal(found[0].level, 'elevated');
});

test('distance from home is elevated', () => {
    const found = findings(reading({ fromHome: 300 }));

    assert.equal(found[0].code, 'far-from-home');
    assert.equal(found[0].level, 'elevated');
});

test('the worst finding sets the level', () => {
    const found = findings(reading({ speed: 4, sensor: 'CELL' }));

    assert.equal(found.length, 2);
    assert.equal(worst(found), 'alarm');
});

test('one noisy fix does not raise an alarm', () => {
    const detector = createDetector();

    const first = detector.assess(reading({ speed: 4 }));
    assert.equal(first.level, 'calm', 'a single spike is not yet trouble');
    assert.equal(first.pending[0].code, 'sprint');
});

test('a sustained condition does raise an alarm', () => {
    const detector = createDetector();

    detector.assess(reading({ speed: 4 }));
    const second = detector.assess(reading({ speed: 3.8 }));

    assert.equal(second.level, 'alarm');
    assert.equal(second.findings[0].code, 'sprint');
});

test('an alarm clears the moment the condition stops', () => {
    const detector = createDetector();

    detector.assess(reading({ speed: 4 }));
    detector.assess(reading({ speed: 4 }));
    const calmed = detector.assess(calm);

    assert.equal(calmed.level, 'calm');
    assert.deepEqual(calmed.findings, []);
});

test('an interrupted condition starts its streak again', () => {
    // Otherwise alternating spikes would accumulate into an alarm that no
    // single moment justified.
    const detector = createDetector();

    detector.assess(reading({ speed: 4 }));
    detector.assess(calm);
    const third = detector.assess(reading({ speed: 4 }));

    assert.equal(third.level, 'calm');
});

test('conditions sustain independently of each other', () => {
    const detector = createDetector();

    detector.assess(reading({ sensor: 'CELL' }));
    const second = detector.assess(reading({ sensor: 'CELL', speed: 4 }));

    assert.equal(second.level, 'elevated', 'GPS loss confirmed, sprint still pending');
    assert.equal(second.pending[0].code, 'sprint');
});

test('thresholds are overridable without touching the logic', () => {
    const jumpy = createDetector({ ...DEFAULTS, sprint: 1.0, sustain: 1 });

    assert.equal(jumpy.assess(reading({ speed: 1.2 })).level, 'alarm');
});
