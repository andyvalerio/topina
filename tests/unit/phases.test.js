/**
 * Phase boundaries decide which fixes count as "walking" versus "still", so
 * an off-by-one here would mislabel the data we tune thresholds against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { numericOption, phaseAt, phaseTag, totalSeconds } from '../../phases.js';

const phases = [
    { label: 'STAND STILL', seconds: 10 },
    { label: 'WALK SLOWLY', seconds: 20 },
];

test('the protocol length is the sum of its phases', () => {
    assert.equal(totalSeconds(phases), 30);
});

test('the first phase starts at zero', () => {
    const active = phaseAt(0, phases);

    assert.equal(active?.index, 0);
    assert.equal(active.into, 0);
});

test('a phase runs up to but not including its boundary', () => {
    assert.equal(phaseAt(9.9, phases)?.index, 0);
    assert.equal(phaseAt(10, phases)?.index, 1, 'the boundary belongs to the next phase');
});

test('progress into a phase is measured from its own start', () => {
    assert.equal(phaseAt(15, phases)?.into, 5);
});

test('past the end there is no phase', () => {
    assert.equal(phaseAt(30, phases), null);
    assert.equal(phaseAt(999, phases), null);
});

test('time before the protocol is warm-up, not a phase', () => {
    // Fixes during the lead-in are GPS settling and someone walking to the
    // door; labelling them as "still" would poison the baseline.
    assert.equal(phaseTag(-5, phases), 'warmup');
});

test('tags are short and ordered', () => {
    assert.equal(phaseTag(0, phases), '1-stand');
    assert.equal(phaseTag(15, phases), '2-walk');
    assert.equal(phaseTag(99, phases), 'done');
});

test('a missing option falls back', () => {
    assert.equal(numericOption(['--phases'], '--lead', 60), 60);
});

test('a present option is read', () => {
    assert.equal(numericOption(['--lead', '15'], '--lead', 60), 15);
});

test('a non-numeric value falls back rather than yielding NaN', () => {
    // NaN reaching setTimeout means "fire immediately", which silently
    // collapses a timed protocol into a single instant.
    assert.equal(numericOption(['--lead', '--phases'], '--lead', 60), 60);
    assert.equal(numericOption(['--lead'], '--lead', 60), 60);
});

test('a negative value falls back', () => {
    assert.equal(numericOption(['--lead', '-5'], '--lead', 60), 60);
});
