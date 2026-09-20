/**
 * Proving the monitor is alive.
 *
 * The worst failure here is silent: the service dies, no alerts arrive, and
 * that looks exactly like a quiet afternoon. You would not find out until the
 * day it mattered. One message a day makes its absence noticeable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, due, message } from '../../heartbeat.js';

test('it is due once the hour has come and it has not been sent today', () => {
    assert.equal(due({ hour: 7, day: '2026-09-20' }, '2026-09-19', 7), true);
});

test('it is not due before the hour', () => {
    assert.equal(due({ hour: 6, day: '2026-09-20' }, '2026-09-19', 7), false);
});

test('it is sent once, not repeatedly all day', () => {
    assert.equal(due({ hour: 14, day: '2026-09-20' }, '2026-09-20', 7), false);
});

test('a service starting late in the day still sends today', () => {
    // Otherwise a restart at noon means a day with no proof of life.
    assert.equal(due({ hour: 22, day: '2026-09-20' }, '2026-09-19', 7), true);
});

test('the first ever run sends', () => {
    assert.equal(due({ hour: 9, day: '2026-09-20' }, null, 7), true);
});

test('day keys are local, not UTC', () => {
    // A UTC day key would roll over mid-evening in Sweden and send twice.
    const date = new Date(2026, 8, 20, 23, 30);

    assert.equal(dayKey(date), '2026-09-20');
});

test('the message says what it is watching and how the tracker is', () => {
    const m = message({ petName: 'Cat', battery: 72, phase: 'waiting', incidentsToday: 0 });

    assert.match(m.title, /Watching Cat/);
    assert.match(m.body, /battery 72%/);
    assert.equal(m.tier, 'info', 'proof of life is not an alarm');
});

test('a charging tracker is described as such', () => {
    assert.match(message({ petName: 'Cat', battery: 100, phase: 'charging', incidentsToday: 0 }).body,
                 /on charge/);
});

test('yesterday incidents are mentioned when there were any', () => {
    const m = message({ petName: 'Cat', battery: 50, phase: 'waiting', incidentsToday: 3 });

    assert.match(m.body, /3 incidents yesterday/);
});

test('no incidents are not mentioned at all', () => {
    const m = message({ petName: 'Cat', battery: 50, phase: 'waiting', incidentsToday: 0 });

    assert.doesNotMatch(m.body, /incident/);
});

test('a missing battery reading does not break the message', () => {
    const m = message({ petName: 'Cat', battery: null, phase: 'waiting', incidentsToday: 0 });

    assert.doesNotMatch(m.body, /battery/);
});
