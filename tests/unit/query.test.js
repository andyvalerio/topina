/**
 * The dashboard hands these values straight to `new Date()`, so anything
 * unusable has to be filtered out here rather than thrown later. A live
 * `GET /export?from=abc` killed the whole service before this existed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_TIME_MS, timeRange, usableTime } from '../../query.js';

const NOW = 1_700_000_000_000;
const HOUR = 3600_000;
const range = (query) => timeRange(new URLSearchParams(query), HOUR, NOW);

test('a well-formed window is passed through untouched', () => {
    const { from, to } = range('from=1000&to=2000');
    assert.equal(from, 1000);
    assert.equal(to, 2000);
});

test('an absent window falls back to the default span', () => {
    const { from, to } = range('');
    assert.equal(from, NOW - HOUR);
    assert.equal(to, NOW);
});

test('an empty value is treated as absent, not as zero', () => {
    // `Number('')` is 0, which would silently export from 1970.
    assert.equal(range('from=&to=').from, NOW - HOUR);
});

test('unparseable values fall back rather than becoming NaN', () => {
    for (const bad of ['abc', 'NaN', 'undefined', '12abc', ' ']) {
        const { from } = range(`from=${encodeURIComponent(bad)}`);
        assert.equal(from, NOW - HOUR, `${bad} should have fallen back`);
        assert.doesNotThrow(() => new Date(from).toISOString());
    }
});

test('finite but unrepresentable values fall back too', () => {
    // The regression that mattered: 9e99 is finite, so a Number.isFinite
    // check alone lets it through and Date throws on it anyway.
    for (const bad of ['9e99', '-9e99', '1e308', 'Infinity', '-Infinity']) {
        const { from } = range(`from=${bad}`);
        assert.equal(from, NOW - HOUR, `${bad} should have fallen back`);
        assert.doesNotThrow(() => new Date(from).toISOString());
    }
});

test('the boundary itself is still usable', () => {
    assert.equal(usableTime(MAX_TIME_MS), true);
    assert.equal(usableTime(MAX_TIME_MS + 1), false);
    assert.doesNotThrow(() => new Date(MAX_TIME_MS).toISOString());
    assert.throws(() => new Date(MAX_TIME_MS + 1).toISOString());
});

test('negative times are legitimate — they are simply before 1970', () => {
    assert.equal(range('from=-1000').from, -1000);
});

test('every output is safe to format, whatever the input', () => {
    const inputs = ['abc', '9e99', '', '0', '-1', 'Infinity', '1e308', 'NaN'];
    for (const a of inputs) {
        for (const b of inputs) {
            const { from, to } = range(`from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}`);
            assert.doesNotThrow(
                () => `${new Date(from).toISOString()}${new Date(to).toISOString()}`,
                `from=${a} to=${b} produced an unformattable window`
            );
        }
    }
});
