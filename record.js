/**
 * Step 4: record everything the channel says to a file.
 *
 * Every raw event is appended as one JSON line — this is the corpus the
 * detector thresholds get tuned against later, and it costs nothing to keep.
 * Derived numbers are printed live so the run can be watched as it happens.
 *
 * Usage: npm run record [seconds] [-- --no-live]
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { listen, HEARTBEAT_MESSAGES } from './channel.js';
import { createTracker } from './state.js';
import { distance } from './geo.js';
import { credentials, missing, petName, trackerId } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const args = process.argv.slice(2);
const seconds = Number(args.find((a) => !a.startsWith('--')) ?? 300);
const useLive = !args.includes('--no-live');

await mkdir('data', { recursive: true });
const file = `data/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const auth = await session(credentials);

if (useLive) {
    console.log('turning live tracking ON...');
    await setLiveTracking(auth.token, trackerId, true);
}

const controller = new AbortController();
setTimeout(() => controller.abort(), seconds * 1000).unref();

// Ctrl-C should stop cleanly and still turn live tracking off.
process.on('SIGINT', () => controller.abort());

const tracker = createTracker();
const fixes = [];
const started = Date.now();
let events = 0;

console.log(`recording ${petName} for ${seconds}s → ${file}\n`);
console.log('    at        time   interval   moved   speed   acc  sensor');

try {
    for await (const event of listen(credentials, { signal: controller.signal })) {
        events += 1;
        await appendFile(file, `${JSON.stringify({ received: Date.now(), event })}\n`);

        if (HEARTBEAT_MESSAGES.has(event.message)) continue;

        const fix = tracker.apply(event);
        if (!fix) continue;

        const previous = fixes.at(-1);
        const moved = previous ? distance(previous.latlong, fix.latlong) : 0;
        const interval = previous ? fix.time - previous.time : 0;
        fixes.push(fix);

        const at = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
        console.log(
            `${at}s  ${fix.time}  ${String(interval).padStart(6)}s  ` +
                `${moved.toFixed(1).padStart(6)}m  ${String(fix.speed).padStart(5)}  ` +
                `${String(fix.accuracy).padStart(4)}  ${fix.sensor_used}`
        );
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

if (useLive) {
    console.log('\nturning live tracking OFF...');
    await setLiveTracking(auth.token, trackerId, false);
}

console.log(`\n${events} events, ${fixes.length} unique fixes → ${file}`);
console.log(`analyse with:  node analyse.js ${file}`);
