/**
 * When to actually buzz the phone.
 *
 * Detectors run every four seconds. Notifying on each firing would mean a
 * dozen buzzes per incident, which trains you to ignore the phone — and an
 * ignored alert is worse than none, since it costs the same attention and
 * buys nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlerter } from '../../alerts.js';

const sprint = { code: 'sprint', level: 'alarm', detail: '3.50 m/s' };
const thrash = { code: 'thrash', level: 'alarm', detail: 'ratio 6.0' };
const T = 1_000_000_000_000;

test('a new finding is announced', () => {
    const alerter = createAlerter();

    assert.deepEqual(alerter.due([sprint], T), [sprint]);
});

test('the same finding is not announced again within the cooldown', () => {
    const alerter = createAlerter({ cooldownMs: 60_000 });

    alerter.due([sprint], T);
    assert.deepEqual(alerter.due([sprint], T + 4_000), [], 'four seconds later is the same incident');
    assert.deepEqual(alerter.due([sprint], T + 30_000), []);
});

test('it is announced again once the cooldown passes', () => {
    const alerter = createAlerter({ cooldownMs: 60_000 });

    alerter.due([sprint], T);
    assert.deepEqual(alerter.due([sprint], T + 60_000), [sprint]);
});

test('a different finding is announced immediately', () => {
    // A sprint cooldown must not silence a thrash: they are different news.
    const alerter = createAlerter({ cooldownMs: 60_000 });

    alerter.due([sprint], T);
    assert.deepEqual(alerter.due([sprint, thrash], T + 4_000), [thrash]);
});

test('a finding that stopped and returns later is announced again', () => {
    // A second incident half an hour on is news, not an echo of the first.
    const alerter = createAlerter({ cooldownMs: 60_000 });

    alerter.due([sprint], T);
    alerter.due([], T + 120_000);
    assert.deepEqual(alerter.due([sprint], T + 180_000), [sprint]);
});

test('nothing happening announces nothing', () => {
    assert.deepEqual(createAlerter().due([], T), []);
});
