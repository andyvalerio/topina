/**
 * Danger zones.
 *
 * The shape of the real one, read from the account: a 100m square named
 * "Enemy kočka", `fence_type: DANGER`, whose nearest corner is 30m from the
 * house. That last detail is why dwell exists — ordinary GPS scatter near the
 * house crosses the boundary, and nine of eleven apparent visits in a week
 * were one or two stray fixes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createZoneWatcher, escalate, inside, tighten } from '../../zones.js';
import { HOME, offset } from '../fixtures/place.js';

/**
 * The real zone's *shape*, built from a fictional home — a 100m square whose
 * nearest corner is 30m away. Stating it as offsets rather than pasting the
 * account's corners keeps a neighbour's address out of a public repo (**G3**)
 * and says what the fixture is for: the tests below care that the boundary
 * sits close enough to the house for ordinary GPS scatter to cross it, not
 * where on Earth it is.
 */
const enemy = {
    shape: 'RECTANGLE',
    coords: [offset(HOME, -50, 30), offset(HOME, 50, 130)],
    radius: null,
    name: 'the neighbour',
};

const middle = offset(HOME, 0, 80);
const away = offset(HOME, -200, 400);

test('a point in the middle of the rectangle is inside', () => {
    assert.equal(inside(middle, enemy), true);
});

test('a point well outside is outside', () => {
    assert.equal(inside(away, enemy), false);
});

test('rectangle corners are handled whichever way round they are given', () => {
    const flipped = { ...enemy, coords: [enemy.coords[1], enemy.coords[0]] };

    assert.equal(inside(middle, flipped), true);
});

test('circles use their radius', () => {
    const circle = { shape: 'CIRCLE', coords: [HOME], radius: 50 };

    assert.equal(inside(offset(HOME, 22, 0), circle), true, 'about 22m away');
    assert.equal(inside(offset(HOME, 110, 0), circle), false, 'about 110m away');
});

test('polygons are handled', () => {
    const square = {
        shape: 'POLYGON',
        coords: [[0, 0], [0, 1], [1, 1], [1, 0]],
        radius: null,
    };

    assert.equal(inside([0.5, 0.5], square), true);
    assert.equal(inside([1.5, 0.5], square), false);
});

test('a malformed fence is outside rather than a crash', () => {
    assert.equal(inside(middle, { shape: 'RECTANGLE', coords: [] }), false);
    assert.equal(inside(middle, { shape: 'RECTANGLE', coords: [[1, 1]] }), false);
});

test('one stray fix does not count as being in the zone', () => {
    // The actual failure in the data: scatter at the edge, 30m from home.
    const watcher = createZoneWatcher(3);

    const first = watcher.update(middle, [enemy]);
    assert.equal(first.inside, false);
    assert.equal(first.entered, false);
});

test('sustained presence does count', () => {
    const watcher = createZoneWatcher(3);

    watcher.update(middle, [enemy]);
    watcher.update(middle, [enemy]);
    const third = watcher.update(middle, [enemy]);

    assert.equal(third.inside, true);
    assert.equal(third.entered, true, 'announced once');
});

test('entering is announced only once', () => {
    const watcher = createZoneWatcher(2);

    watcher.update(middle, [enemy]);
    watcher.update(middle, [enemy]);
    const fourth = watcher.update(middle, [enemy]);

    assert.equal(fourth.inside, true);
    assert.equal(fourth.entered, false, 'still inside is not news again');
});

test('a scatter streak is broken by any fix outside', () => {
    // Otherwise stray edge fixes would accumulate into a phantom entry.
    const watcher = createZoneWatcher(3);

    watcher.update(middle, [enemy]);
    watcher.update(away, [enemy]);
    const third = watcher.update(middle, [enemy]);

    assert.equal(third.inside, false);
});

test('leaving is immediate, not dwelled', () => {
    // Staying in a raised-risk state after she has left would tighten
    // thresholds somewhere harmless.
    const watcher = createZoneWatcher(2);

    watcher.update(middle, [enemy]);
    watcher.update(middle, [enemy]);
    const out = watcher.update(away, [enemy]);

    assert.equal(out.inside, false);
    assert.equal(out.left, true);
});

test('no position means not in a zone', () => {
    const watcher = createZoneWatcher(1);

    assert.equal(watcher.update(null, [enemy]).inside, false);
});

test('tightening lowers the bar for an alarm', () => {
    const base = { sprint: 3.0, thrash: 4, silenceS: 90, moving: 0.4 };
    const tight = tighten(base, 0.7);

    assert.ok(tight.sprint < base.sprint, 'a sprint means more in the rival garden');
    assert.ok(tight.thrash < base.thrash);
    assert.ok(tight.silenceS < base.silenceS);
    assert.equal(tight.moving, base.moving, 'untouched thresholds pass through');
});

test('escalation raises elevated to alarm and leaves alarms alone', () => {
    const raised = escalate([
        { code: 'no-gps', level: 'elevated' },
        { code: 'sprint', level: 'alarm' },
    ]);

    assert.equal(raised[0].level, 'alarm');
    assert.equal(raised[1].level, 'alarm');
});
