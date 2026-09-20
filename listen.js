/**
 * Step 3: does the channel actually push anything?
 *
 * Prints every message the channel sends, heartbeats included, and tallies
 * them by type. What we want to know: that the connection holds, how chatty it
 * is, and what the events actually look like.
 *
 * Usage: npm run listen [seconds]
 */
import { listen, HEARTBEAT_MESSAGES } from './channel.js';
import { credentials, missing, petName } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const seconds = Number(process.argv[2] ?? 60);
const controller = new AbortController();
setTimeout(() => controller.abort(), seconds * 1000).unref();

console.log(`listening for ${seconds}s — watching ${petName}\n`);

const counts = new Map();
const started = Date.now();
let total = 0;

try {
    for await (const event of listen(credentials, { signal: controller.signal })) {
        total += 1;
        counts.set(event.message, (counts.get(event.message) ?? 0) + 1);

        const elapsed = ((Date.now() - started) / 1000).toFixed(1).padStart(6);
        if (HEARTBEAT_MESSAGES.has(event.message)) {
            console.log(`${elapsed}s  ${event.message}`);
        } else {
            console.log(`${elapsed}s  ${event.message}`);
            console.dir(event, { depth: null });
        }
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

console.log(`\n--- ${total} messages in ${seconds}s ---`);
for (const [message, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${message}`);
}
