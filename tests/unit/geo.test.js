/**
 * Distance underpins every movement signal, so an error here would be invisible
 * and corrupt everything downstream.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { centroid, distance } from '../../geo.js';

test('a point is zero metres from itself', () => {
    assert.equal(distance([57.761, 12.0646], [57.761, 12.0646]), 0);
});

test('one degree of latitude is about 111km', () => {
    const metres = distance([0, 0], [1, 0]);

    assert.ok(Math.abs(metres - 111195) < 100, `expected ~111195m, got ${metres}`);
});

test('distance is symmetric', () => {
    const a = [57.761, 12.0646];
    const b = [57.7615, 12.0652];

    assert.equal(distance(a, b), distance(b, a));
});

test('distance resolves the metre scale we actually care about', () => {
    // ~0.00001 degrees of latitude is a bit over a metre; GPS noise lives here.
    const metres = distance([57.761, 12.0646], [57.76101, 12.0646]);

    assert.ok(metres > 0.5 && metres < 2, `expected ~1m, got ${metres}`);
});

test('centroid averages the points', () => {
    assert.deepEqual(centroid([[0, 0], [2, 4]]), [1, 2]);
});

test('centroid of a single point is that point', () => {
    assert.deepEqual(centroid([[57.761, 12.0646]]), [57.761, 12.0646]);
});
