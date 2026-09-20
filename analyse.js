/**
 * Read a recording and report the numbers the detectors depend on.
 *
 * Run against a stationary outdoor recording this measures the noise floor —
 * the apparent movement and speed of something that is definitively not
 * moving. Every detector threshold has to clear it, and if it can't be
 * cleared, the movement heuristics don't work (**C3**, **Q2**).
 *
 * Usage: node analyse.js data/<recording>.jsonl
 */
import { readFile } from 'node:fs/promises';
import { centroid, distance } from './geo.js';

const file = process.argv[2];
if (!file) {
    console.error('usage: node analyse.js data/<recording>.jsonl');
    process.exit(1);
}

const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);

const counts = new Map();
const fixes = [];
let lastFixTime = null;

for (const line of lines) {
    const { event } = JSON.parse(line);
    counts.set(event.message, (counts.get(event.message) ?? 0) + 1);

    const position = event.position;
    if (!position?.latlong || position.time === lastFixTime) continue;
    lastFixTime = position.time;
    fixes.push(position);
}

console.log(`${file}\n${lines.length} events, ${fixes.length} unique fixes\n`);

console.log('--- message types ---');
for (const [message, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${message}`);
}

if (fixes.length < 2) {
    console.log('\nNot enough fixes to analyse. Was live tracking on, and was it outdoors?');
    process.exit(0);
}

// The first fixes after live tracking engages are a stale cached report and a
// catch-up jump. They are real, but they are not the cadence, and their
// distance would swamp the noise floor we are trying to measure.
const SETTLED_GAP_S = 30;
const firstSettled = fixes.findIndex(
    (fix, i) => i > 0 && fix.time - fixes[i - 1].time <= SETTLED_GAP_S
);
const settled = firstSettled > 0 ? fixes.slice(firstSettled) : fixes;
const discarded = fixes.length - settled.length;

const span = settled.at(-1).time - settled[0].time;
console.log(`\n--- coverage ---`);
console.log(`  total fixes     ${fixes.length}`);
if (discarded) console.log(`  warm-up dropped ${discarded} (stale/catch-up fixes before cadence settled)`);
console.log(`  analysed        ${settled.length}`);
console.log(`  span            ${span}s (${(span / 60).toFixed(1)} min)`);

// Q1: the real live-mode cadence.
const intervals = settled.slice(1).map((fix, i) => fix.time - settled[i].time);
report('fix interval (s)', intervals);

// Q2: the noise floor. A stationary tracker's spread around its own mean.
const points = settled.map((fix) => fix.latlong);
const middle = centroid(points);
const spread = points.map((point) => distance(middle, point));
report('spread from centroid (m)', spread);

// What a naive detector would see as movement between consecutive fixes.
const steps = points.slice(1).map((point, i) => distance(points[i], point));
report('apparent movement per fix (m)', steps);

// Q3: derived speed versus what Tractive reports.
const derived = steps.map((step, i) => (intervals[i] > 0 ? step / intervals[i] : 0));
report('derived speed (m/s)', derived);
const reported = settled.map((fix) => fix.speed).filter((s) => typeof s === 'number');
if (reported.length) {
    report('reported speed (m/s)', reported);
} else {
    console.log('\n--- reported speed ---\n  absent: live-mode fixes carry no speed field');
}

// Q4: is accuracy worth gating on?
report('accuracy (m)', settled.map((fix) => fix.accuracy).filter((a) => typeof a === 'number'));

const sensors = new Map();
for (const fix of settled) sensors.set(fix.sensor_used, (sensors.get(fix.sensor_used) ?? 0) + 1);
console.log('\n--- sensor used ---');
for (const [sensor, count] of sensors) console.log(`  ${String(count).padStart(5)}  ${sensor}`);

console.log('\n--- what this means ---');
const p95Spread = percentile(spread, 95);
const p95Step = percentile(steps, 95);
console.log(`  95% of fixes land within ${p95Spread.toFixed(1)}m of the true position.`);
console.log(`  A stationary tracker appears to move up to ${Math.max(...steps).toFixed(1)}m`);
console.log(`  between fixes (95th percentile ${p95Step.toFixed(1)}m).`);
console.log(`  Any movement threshold must clear that to avoid constant false alarms.`);

/**
 * @param {string} label
 * @param {number[]} values
 */
function report(label, values) {
    if (!values.length) return;
    console.log(`\n--- ${label} ---`);
    console.log(`  min     ${fmt(Math.min(...values))}`);
    console.log(`  median  ${fmt(percentile(values, 50))}`);
    console.log(`  mean    ${fmt(values.reduce((a, b) => a + b, 0) / values.length)}`);
    console.log(`  p95     ${fmt(percentile(values, 95))}`);
    console.log(`  max     ${fmt(Math.max(...values))}`);
}

/** @param {number} n */
function fmt(n) {
    return n.toFixed(2).padStart(8);
}

/**
 * @param {number[]} values
 * @param {number} p
 * @returns {number}
 */
function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index];
}
