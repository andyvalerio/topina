/**
 * What a notification says, and how loudly.
 *
 * Away from home this is the entire experience — the dashboard is LAN-only —
 * so the body has to stand alone. And the tiers have to differ: "she is out"
 * arriving with the same weight as "sprint in the enemy's garden" would train
 * you to ignore both.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    batteryStepCrossed,
    forBattery,
    forFindings,
    forOuting,
    TRACTIVE_APP,
} from '../../notifications.js';
import { HOME } from '../fixtures/place.js';

const context = {
    petName: 'Cat',
    distanceM: 43.2,
    latlong: HOME,
    battery: 80,
    zone: null,
};

test('going out is information, not an alarm', () => {
    const n = forOuting('out', context);

    assert.equal(n.tier, 'info');
    assert.match(n.title, /is out/);
});

test('coming home is information', () => {
    assert.equal(forOuting('home', context).tier, 'info');
});

test('losing signal is an alarm', () => {
    // She is out there and we cannot see her. This is the one that matters.
    const n = forOuting('signal-lost', context);

    assert.equal(n.tier, 'alarm');
});

test('every notification carries how far from home she is', () => {
    // The body must stand alone: away from home there is no dashboard.
    const n = forOuting('signal-lost', context);

    assert.match(n.body, /43m from home/);
});

test('coordinates are not in the body', () => {
    // Nobody reads six decimal places on a lock screen, and tapping through
    // shows her on a map anyway.
    const n = forOuting('signal-lost', context);

    assert.doesNotMatch(n.body, /57\.76/);
});

test('titles read like someone telling you something', () => {
    assert.equal(forFindings([{ code: 'sprint', level: 'alarm', detail: '4 m/s' }], context).title,
                 'Cat bolted');
    assert.equal(forFindings([{ code: 'no-gps', level: 'elevated', detail: 'CELL' }], context).title,
                 'Cat is under cover');
    assert.equal(forOuting('signal-lost', context).title, "Can't see Cat");
});

test('a notification without a position still reads properly', () => {
    const n = forOuting('home', { ...context, distanceM: null, latlong: null });

    assert.equal(n.body, 'live tracking off');
});

test('tapping through opens the Tractive app', () => {
    // They already built a map. Deeper paths open it on an error (C28).
    assert.equal(forOuting('out', context).url, TRACTIVE_APP);
    assert.equal(forFindings([{ code: 'sprint', level: 'alarm', detail: '4 m/s' }], context).url, TRACTIVE_APP);
});

test('an alarm finding leads the title', () => {
    const n = forFindings(
        [
            { code: 'no-gps', level: 'elevated', detail: 'from CELL' },
            { code: 'sprint', level: 'alarm', detail: '4.20 m/s' },
        ],
        context
    );

    assert.match(n.title, /bolted/, 'the worst thing leads');
    assert.equal(n.tier, 'alarm');
});

test('an elevated finding is a warning, not an alarm', () => {
    const n = forFindings([{ code: 'no-gps', level: 'elevated', detail: 'from CELL' }], context);

    assert.equal(n.tier, 'warn');
});

test('being in the danger zone is named in the title', () => {
    const n = forFindings([{ code: 'sprint', level: 'alarm', detail: '3 m/s' }], {
        ...context,
        zone: 'Enemy kočka',
    });

    assert.match(n.title, /bolted in Enemy kočka/);
});

test('all findings appear in the body', () => {
    const n = forFindings(
        [
            { code: 'sprint', level: 'alarm', detail: '4.20 m/s' },
            { code: 'thrash', level: 'alarm', detail: 'ratio 7.1' },
        ],
        context
    );

    assert.match(n.body, /4\.20 m\/s/);
    assert.match(n.body, /ratio 7\.1/);
});

test('a battery step down is a warning', () => {
    assert.equal(forBattery(60, 'Cat').tier, 'warn');
});

test('a nearly flat battery is an alarm', () => {
    // Tracking stops when it dies, which is worse than never having tracked.
    assert.equal(forBattery(20, 'Cat').tier, 'alarm');
    assert.match(forBattery(20, 'Cat').title, /tracker is at 20%/);
    assert.match(forBattery(20, 'Cat').body, /charge it/);
});

test('crossing a ten percent step is reported once', () => {
    assert.equal(batteryStepCrossed(81, 79, 10), 70);
    assert.equal(batteryStepCrossed(79, 78, 10), null, 'still in the same band');
});

test('battery going up reports nothing', () => {
    // Charging is not news.
    assert.equal(batteryStepCrossed(70, 90, 10), null);
});

test('the first reading reports nothing', () => {
    assert.equal(batteryStepCrossed(null, 55, 10), null);
});

test('a big drop reports the band it landed in', () => {
    assert.equal(batteryStepCrossed(95, 42, 10), 40);
});
