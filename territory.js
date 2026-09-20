/**
 * What is normal for this cat.
 *
 * The `far-from-home` detector currently fires at a flat 150m, a number with
 * no evidence behind it. Weeks of her own history can replace that with a
 * percentile of where she actually goes, turning an arbitrary radius into
 * "unusual for her".
 *
 * History also carries stretches recorded in live mode, which are the only
 * real cat speeds we have — everything measured so far was a human walking.
 *
 *   npm run territory [days]
 *
 * Fetched history is cached under data/, since the API rate-limits hard and
 * the same week can be analysed many times while tuning.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { session } from './auth.js';
import { authHeaders } from './auth.js';
import { getPet } from './rest.js';
import { distance } from './geo.js';
import { credentials, missing, petId, trackerId } from './config.js';

const days = Number(process.argv[2] ?? 7);

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID', 'TRACTIVE_PET_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

await mkdir('data', { recursive: true });
const cache = `data/history-${days}d.json`;

const { token } = await session(credentials);

let points;
try {
    points = JSON.parse(await readFile(cache, 'utf8'));
    console.log(`using cached ${cache}`);
} catch {
    const now = Math.floor(Date.now() / 1000);
    const url =
        `https://graph.tractive.com/4/tracker/${trackerId}/positions` +
        `?time_from=${now - days * 86400}&time_to=${now}&format=json_segments`;
    const res = await fetch(url, { headers: authHeaders(token) });
    const segments = await res.json();
    points = (segments ?? []).flat();
    await writeFile(cache, JSON.stringify(points));
    console.log(`fetched ${points.length} points → ${cache}`);
}

const pet = await getPet(token, petId);
const home = pet?.home_location;
if (!Array.isArray(home)) {
    console.error('no home_location on the pet record');
    process.exit(1);
}

console.log(`\n${points.length} positions over ${days} days\n`);

// --- where she goes -------------------------------------------------------

const fromHome = points.map((p) => distance(home, p.latlong)).sort((a, b) => a - b);

console.log('--- distance from home (m) ---');
for (const p of [50, 75, 90, 95, 99, 99.9]) {
    console.log(`  p${String(p).padEnd(5)} ${pct(fromHome, p).toFixed(0).padStart(6)}`);
}
console.log(`  max    ${fromHome.at(-1).toFixed(0).padStart(6)}`);

const beyond = (m) => ((fromHome.filter((d) => d > m).length / fromHome.length) * 100).toFixed(1);
console.log(`\n  beyond the current 150m threshold: ${beyond(150)}% of the time`);
console.log(`  beyond 100m: ${beyond(100)}%   beyond 200m: ${beyond(200)}%`);

// --- how fast she actually moves -----------------------------------------
// Only consecutive points a few seconds apart say anything about speed; a gap
// of minutes averages a sprint and a nap into the same meaningless number.

const MAX_GAP_S = 10;
const speeds = [];
for (let i = 1; i < points.length; i++) {
    const gap = points[i].time - points[i - 1].time;
    if (gap <= 0 || gap > MAX_GAP_S) continue;
    speeds.push(distance(points[i - 1].latlong, points[i].latlong) / gap);
}
speeds.sort((a, b) => a - b);

console.log(`\n--- her own speed (m/s), from ${speeds.length} fixes ≤${MAX_GAP_S}s apart ---`);
if (speeds.length < 20) {
    console.log('  not enough dense history — needs more time in live mode');
} else {
    for (const p of [50, 90, 95, 99, 99.9]) {
        console.log(`  p${String(p).padEnd(5)} ${pct(speeds, p).toFixed(2).padStart(6)}`);
    }
    console.log(`  max    ${speeds.at(-1).toFixed(2).padStart(6)}`);
    console.log(`\n  current sprint threshold 2.50 would fire on ${((speeds.filter((s) => s >= 2.5).length / speeds.length) * 100).toFixed(2)}% of her fixes`);
}

// --- when she is out ------------------------------------------------------

const AWAY_M = 30;
const byHour = new Array(24).fill(0);
const totalByHour = new Array(24).fill(0);
for (const p of points) {
    const hour = new Date(p.time * 1000).getHours();
    totalByHour[hour] += 1;
    if (distance(home, p.latlong) > AWAY_M) byHour[hour] += 1;
}

console.log(`\n--- share of fixes more than ${AWAY_M}m from home, by hour ---`);
for (let h = 0; h < 24; h++) {
    if (!totalByHour[h]) continue;
    const share = byHour[h] / totalByHour[h];
    console.log(`  ${String(h).padStart(2, '0')}:00 ${'█'.repeat(Math.round(share * 40)).padEnd(40)} ${(share * 100).toFixed(0)}%`);
}

console.log('\n--- sensors ---');
const sensors = new Map();
for (const p of points) sensors.set(p.sensor_used, (sensors.get(p.sensor_used) ?? 0) + 1);
for (const [sensor, count] of [...sensors].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${sensor}  (${((count / points.length) * 100).toFixed(1)}%)`);
}

/** @param {number[]} sorted @param {number} p */
function pct(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
