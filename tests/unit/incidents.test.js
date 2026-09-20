/**
 * Incidents.
 *
 * A finding belongs to one reading and vanishes with it, which is fine for
 * deciding whether to buzz a phone and useless afterwards. An incident is the
 * thing that happened: when it started, what fired, what it peaked at, and
 * whether it was in the rival's garden.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidents } from '../../incidents.js';

const T = 1_000_000_000_000;
const sprint = [{ code: 'sprint', level: 'alarm', detail: '4 m/s' }];
const thrash = [{ code: 'thrash', level: 'alarm', detail: 'ratio 7' }];
const signals = (over = {}) => ({ speed: 4, thrash: 7, fromHome: 50, ...over });

const input = (findings, over = {}) => ({
    findings,
    signals: signals(),
    zone: null,
    nowMs: T,
    ...over,
});

test('a finding opens an incident', () => {
    const incidents = createIncidents();
    const { opened } = incidents.update(input(sprint));

    assert.ok(opened);
    assert.deepEqual(opened.codes, ['sprint']);
    assert.equal(opened.startedAt, T);
});

test('calm readings open nothing', () => {
    const incidents = createIncidents();

    assert.equal(incidents.update(input([])).opened, null);
    assert.equal(incidents.current(), null);
});

test('a continuing incident is not reopened', () => {
    const incidents = createIncidents();
    incidents.update(input(sprint));
    const second = incidents.update(input(sprint, { nowMs: T + 4000 }));

    assert.equal(second.opened, null, 'still the same incident');
});

test('new findings join the incident they happened during', () => {
    const incidents = createIncidents();
    incidents.update(input(sprint));
    const { open } = incidents.update(input(thrash, { nowMs: T + 4000 }));

    assert.deepEqual(open.codes, ['sprint', 'thrash']);
});

test('a code is recorded once however often it fires', () => {
    const incidents = createIncidents();
    incidents.update(input(sprint));
    incidents.update(input(sprint, { nowMs: T + 4000 }));

    assert.deepEqual(incidents.current().codes, ['sprint']);
});

test('the incident keeps what it peaked at', () => {
    // "What was she actually doing?" needs an answer later.
    const incidents = createIncidents();
    incidents.update(input(sprint, { signals: signals({ speed: 3, thrash: 5, fromHome: 20 }) }));
    incidents.update(input(sprint, { nowMs: T + 4000, signals: signals({ speed: 9, thrash: 4, fromHome: 80 }) }));
    incidents.update(input(sprint, { nowMs: T + 8000, signals: signals({ speed: 2, thrash: 11, fromHome: 40 }) }));

    const peak = incidents.current().peak;
    assert.equal(peak.speed, 9);
    assert.equal(peak.thrash, 11);
    assert.equal(peak.fromHome, 80);
});

test('quiet does not close an incident immediately', () => {
    // Detectors flicker; a gap of a few seconds is the same incident.
    const incidents = createIncidents({ closeAfterMs: 60_000 });
    incidents.update(input(sprint));
    const { closed } = incidents.update(input([], { nowMs: T + 5000 }));

    assert.equal(closed, null);
});

test('sustained quiet closes it', () => {
    const incidents = createIncidents({ closeAfterMs: 60_000 });
    incidents.update(input(sprint));
    const { closed } = incidents.update(input([], { nowMs: T + 60_000 }));

    assert.ok(closed);
    assert.equal(closed.endedAt, T, 'it ended when it stopped, not when we noticed');
    assert.equal(incidents.current(), null);
});

test('a later finding starts a new incident', () => {
    const incidents = createIncidents({ closeAfterMs: 60_000 });
    incidents.update(input(sprint));
    incidents.update(input([], { nowMs: T + 60_000 }));
    const { opened } = incidents.update(input(thrash, { nowMs: T + 120_000 }));

    assert.ok(opened);
    assert.deepEqual(opened.codes, ['thrash']);
});

test('the danger zone is remembered on the incident', () => {
    const incidents = createIncidents();
    const { opened } = incidents.update(input(sprint, { zone: 'Enemy kočka' }));

    assert.equal(opened.zone, 'Enemy kočka');
});

test('entering the zone partway through still describes the incident', () => {
    const incidents = createIncidents();
    incidents.update(input(sprint));
    incidents.update(input(sprint, { nowMs: T + 4000, zone: 'Enemy kočka' }));

    assert.equal(incidents.current().zone, 'Enemy kočka');
});

test('an open incident survives a restart', () => {
    // Otherwise a restart mid-incident loses the thing worth reviewing.
    const before = createIncidents();
    before.update(input(sprint));
    const carried = before.current();

    const after = createIncidents();
    after.restore(carried);
    after.update(input(thrash, { nowMs: T + 4000 }));

    assert.deepEqual(after.current().codes, ['sprint', 'thrash']);
    assert.equal(after.current().startedAt, T);
});

test('missing signals do not break the peaks', () => {
    const incidents = createIncidents();
    incidents.update(input(sprint, { signals: { speed: null, thrash: null, fromHome: null } }));
    incidents.update(input(sprint, { nowMs: T + 4000, signals: signals({ speed: 5 }) }));

    assert.equal(incidents.current().peak.speed, 5);
});
