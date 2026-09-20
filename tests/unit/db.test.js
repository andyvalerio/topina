/**
 * Persistence.
 *
 * Two behaviours here are load-bearing and easy to get subtly wrong: settings
 * seed once and then the stored value wins (so a later environment edit does
 * nothing, which must at least be *visible*), and the outing state survives a
 * restart — without it a service restarted mid-outing forgets she is outside
 * and silently stops tracking her.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../../db.js';

const fresh = () => open(join(mkdtempSync(join(tmpdir(), 'topina-')), 'test.db'));

test('a seeded setting is readable', () => {
    const db = fresh();
    db.seed('sampleIntervalS', 180, 'default');

    assert.equal(db.get('sampleIntervalS'), 180);
    db.close();
});

test('seeding does not overwrite a stored value', () => {
    // The showgrab behaviour: once it exists, the environment stops mattering.
    const db = fresh();
    db.seed('sampleIntervalS', 180, 'default');
    db.set('sampleIntervalS', 60);
    db.seed('sampleIntervalS', 999, 'env');

    assert.equal(db.get('sampleIntervalS'), 60, 'the dashboard value wins');
    db.close();
});

test('where a value came from is recorded', () => {
    // So the dashboard can explain why editing an env var did nothing.
    const db = fresh();
    db.seed('a', 1, 'default');
    db.seed('b', 2, 'env');
    db.set('a', 9);

    const byKey = Object.fromEntries(db.settings().map((s) => [s.key, s.source]));
    assert.equal(byKey.a, 'dashboard');
    assert.equal(byKey.b, 'env');
    db.close();
});

test('an unknown setting reads as undefined, not a crash', () => {
    const db = fresh();
    assert.equal(db.get('nothing'), undefined);
    db.close();
});

test('settings survive reopening the database', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'topina-')), 'test.db');
    const first = open(path);
    first.set('quietS', 240);
    first.close();

    const second = open(path);
    assert.equal(second.get('quietS'), 240);
    second.close();
});

test('the outing state survives a restart', () => {
    // The whole point: a service restarted mid-outing must still know she is
    // outside, rather than quietly stopping.
    const path = join(mkdtempSync(join(tmpdir(), 'topina-')), 'test.db');
    const first = open(path);
    first.saveState('outing', { phase: 'out', since: 1234 });
    first.close();

    const second = open(path);
    assert.deepEqual(second.loadState('outing'), { phase: 'out', since: 1234 });
    second.close();
});

test('missing state reads as null so a first start works', () => {
    const db = fresh();
    assert.equal(db.loadState('outing'), null);
    db.close();
});

test('events are recorded and read back in time order', () => {
    const db = fresh();
    db.record('out', { from: 'sampling' }, 1000);
    db.record('home', null, 3000);
    db.record('out', null, 2000);

    const all = db.events(0, 9999);
    assert.deepEqual(all.map((e) => e.ts), [1000, 2000, 3000]);
    assert.deepEqual(all[0].data, { from: 'sampling' });
    db.close();
});

test('events can be fetched for a window, which is how export will work', () => {
    const db = fresh();
    db.record('a', null, 1000);
    db.record('b', null, 5000);
    db.record('c', null, 9000);

    assert.deepEqual(db.events(2000, 6000).map((e) => e.kind), ['b']);
    db.close();
});

test('an event with no data round-trips as null', () => {
    const db = fresh();
    db.record('home', null, 1);

    assert.equal(db.events(0, 9)[0].data, null);
    db.close();
});

test('old events are pruned', () => {
    // Raw fixes accumulate forever otherwise: a full day live is thousands.
    const db = fresh();
    db.record('fix', { speed: 1 }, 1000);
    db.record('fix', { speed: 2 }, 9000);

    db.prune(5000);

    assert.deepEqual(db.events(0, 99999).map((e) => e.ts), [9000]);
    db.close();
});

test('pruning leaves incidents alone', () => {
    // They are scarce and they are the part worth keeping.
    const db = fresh();
    db.addIncident({ startedAt: 1000, endedAt: 2000, codes: ['sprint'], peak: { speed: 9 }, zone: null });
    db.record('fix', null, 1000);

    db.prune(5000);

    assert.equal(db.events(0, 99999).length, 0);
    assert.equal(db.incidents().length, 1, 'the incident survives');
    db.close();
});

test('incidents round-trip with their peaks and zone', () => {
    const db = fresh();
    db.addIncident({
        startedAt: 1000, endedAt: 2000,
        codes: ['sprint', 'thrash'],
        peak: { speed: 9.4, thrash: 7.1, fromHome: 80 },
        zone: 'Enemy kočka',
    });

    const [incident] = db.incidents();
    assert.deepEqual(incident.codes, ['sprint', 'thrash']);
    assert.equal(incident.peak.speed, 9.4);
    assert.equal(incident.peak.zone, 'Enemy kočka');
    assert.equal(incident.label, null, 'unlabelled until someone says');
    db.close();
});

test('labelling an incident sticks', () => {
    const db = fresh();
    db.addIncident({ startedAt: 1, endedAt: 2, codes: ['sprint'], peak: {}, zone: null });
    const [before] = db.incidents();

    db.labelIncident(before.id, 'real');

    assert.equal(db.incidents()[0].label, 'real');
    db.close();
});
