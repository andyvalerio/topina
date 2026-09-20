/**
 * A bounded live-tracking observation.
 *
 * Turns live tracking on, watches the channel for a fixed window, then turns
 * it back off — the point is to learn the real fix cadence and what a position
 * event looks like, not to leave the battery draining.
 *
 * Usage: npm run live [seconds]
 */
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { listen, HEARTBEAT_MESSAGES } from './channel.js';
import { credentials, missing, petName, trackerId } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const seconds = Number(process.argv[2] ?? 60);
const auth = await session(credentials);

console.log(`turning live tracking ON for ${petName}...`);
console.dir(await setLiveTracking(auth.token, trackerId, true), { depth: null });

const controller = new AbortController();
setTimeout(() => controller.abort(), seconds * 1000).unref();

const started = Date.now();
const counts = new Map();
const fixes = [];

console.log(`\nlistening for ${seconds}s\n`);

try {
    for await (const event of listen(credentials, { signal: controller.signal })) {
        counts.set(event.message, (counts.get(event.message) ?? 0) + 1);
        const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(6);

        if (HEARTBEAT_MESSAGES.has(event.message)) {
            process.stdout.write(`${elapsed}s  ${event.message}\r`);
            continue;
        }

        console.log(`${elapsed}s  ${event.message}`);
        console.dir(event, { depth: null });

        const position = event.position ?? (event.latlong ? event : null);
        if (position?.latlong) fixes.push(position);
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

console.log('\n\nturning live tracking OFF...');
console.dir(await setLiveTracking(auth.token, trackerId, false), { depth: null });

console.log(`\n--- message counts over ${seconds}s ---`);
for (const [message, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${message}`);
}

console.log(`\n--- ${fixes.length} position fixes ---`);
fixes.forEach((fix, i) => {
    const previous = fixes[i - 1];
    const gap = previous ? `${fix.time - previous.time}s since previous fix` : '';
    console.log(
        `  time=${fix.time} rcvd=${fix.time_rcvd} acc=${fix.accuracy}m ` +
            `speed=${fix.speed} sensor=${fix.sensor_used} ${gap}`
    );
});
