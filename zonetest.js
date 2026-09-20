/**
 * Step 1: does the channel tell us when she leaves?
 *
 * The whole outing lifecycle hangs on this. If leaving the home zone arrives
 * as a push event, "she is out" costs nothing and arrives promptly. If it does
 * not, we fall back to watching distance-from-home on low-resolution fixes —
 * workable, but slower and less certain (**Q19**).
 *
 * Deliberately runs with live tracking OFF. The point is to learn what the
 * cheap always-on mode reports, since that is the condition the detector would
 * actually live in.
 *
 * Prompts go to stdout so this can run under a Monitor and reach a phone;
 * everything else goes to stderr.
 *
 *   node zonetest.js [minutes]
 */
import { session } from './auth.js';
import { getPet, getTracker } from './rest.js';
import { listen, HEARTBEAT_MESSAGES } from './channel.js';
import { distance } from './geo.js';
import { credentials, missing, petId, trackerId } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID', 'TRACTIVE_PET_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const minutes = Number(process.argv[2] ?? 8);
const prompt = (line) => console.log(line);
const detail = (line) => console.error(line);

const { token } = await session(credentials);
const pet = await getPet(token, petId);
const home = pet?.home_location;

// The zone fields live on the tracker record; watching them change is the
// fallback evidence if no explicit crossing event ever arrives.
const before = await getTracker(token, trackerId);
detail(`zone before: ${before.prioritized_zone_type} id=${before.prioritized_zone_id}`);
detail(`entered_at=${before.prioritized_zone_entered_at} last_seen=${before.prioritized_zone_last_seen_at}`);

const controller = new AbortController();
setTimeout(() => controller.abort(), minutes * 60_000).unref();

const schedule = [
    [0, 'Baseline — leave the tracker indoors, do nothing (60s)'],
    [60, 'NOW: carry the tracker outside, away from the house, 80m or so'],
    [90, 'Keep it out there. Watching for what the channel says.'],
    [330, 'NOW: bring it back inside'],
    [420, 'Done — you can stop.'],
];
for (const [at, text] of schedule) setTimeout(() => prompt(text), at * 1000).unref();

prompt(`Zone test running for ${minutes} min. Live tracking stays OFF on purpose.`);

const started = Date.now();
const seen = new Map();
let lastZone = JSON.stringify({
    type: before.prioritized_zone_type,
    id: before.prioritized_zone_id,
    entered: before.prioritized_zone_entered_at,
});

try {
    for await (const event of listen(credentials, { signal: controller.signal })) {
        if (HEARTBEAT_MESSAGES.has(event.message)) continue;

        const at = ((Date.now() - started) / 1000).toFixed(0).padStart(4);
        seen.set(event.message, (seen.get(event.message) ?? 0) + 1);

        // Anything mentioning a zone or fence is the thing we are hunting.
        const text = JSON.stringify(event);
        const interesting = /zone|fence|geofen|IN_TO_OUT|OUT_TO_IN|left|enter/i.test(text);

        detail(`${at}s  ${event.message}${interesting ? '   <<< ZONE-RELATED' : ''}`);
        if (interesting) {
            detail(`      ${text.slice(0, 600)}`);
            prompt(`zone-related event: ${event.message}`);
        }

        if (event.position?.latlong && home) {
            detail(`      ${distance(home, event.position.latlong).toFixed(0)}m from home, ${event.position.sensor_used}`);
        }
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

const after = await getTracker(token, trackerId);
const nowZone = JSON.stringify({
    type: after.prioritized_zone_type,
    id: after.prioritized_zone_id,
    entered: after.prioritized_zone_entered_at,
});

detail('\n--- message types seen ---');
for (const [message, count] of [...seen].sort((a, b) => b[1] - a[1])) {
    detail(`  ${String(count).padStart(4)}  ${message}`);
}
detail(`\nzone fields changed: ${lastZone !== nowZone}`);
detail(`  before: ${lastZone}`);
detail(`  after:  ${nowZone}`);
prompt(`Finished. Zone fields changed: ${lastZone !== nowZone}`);
