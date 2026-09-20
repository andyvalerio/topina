/**
 * Record everything the channel says to a file.
 *
 * Every raw event is appended as one JSON line — this is the corpus the
 * detector thresholds get tuned against later, and it costs nothing to keep.
 *
 * With `--phases` it walks a guided protocol (see phases.js), tagging each
 * fix with the pace being walked. In that mode **stdout carries only phase
 * prompts**: the script is meant to run under a Monitor, where every stdout
 * line becomes a notification that reaches a phone. Fix detail goes to stderr
 * instead, so it is captured without setting off a notification per fix.
 *
 * Usage: npm run record [seconds] [-- --no-live] [-- --phases] [-- --lead 60]
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { listen, HEARTBEAT_MESSAGES } from './channel.js';
import { createTracker } from './state.js';
import { distance } from './geo.js';
import { credentials, missing, petName, trackerId } from './config.js';
import { numericOption, phaseTag, totalSeconds, WALK_PROTOCOL } from './phases.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const args = process.argv.slice(2);
const useLive = !args.includes('--no-live');
const guided = args.includes('--phases');
// Time to get outside before the protocol starts. It doubles as GPS warm-up:
// the first fixes after live tracking engages are stale and catching up.
const leadIn = guided ? numericOption(args, '--lead', 60) : 0;
const seconds =
    (guided ? totalSeconds(WALK_PROTOCOL) : Number(args.find((a) => !a.startsWith('--')) ?? 300)) +
    leadIn;

/** Phase prompts are the only thing allowed on stdout in guided mode. */
const prompt = (line) => console.log(line);
const detail = (line) => (guided ? console.error(line) : console.log(line));

await mkdir('data', { recursive: true });
const file = `data/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const auth = await session(credentials);

if (useLive) {
    detail('turning live tracking ON...');
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

detail(`recording ${petName} for ${seconds}s → ${file}\n`);
detail('    at        time   interval   moved   speed   acc  sensor');

if (guided) {
    prompt(
        `Live tracking ON. Head outside — the protocol starts in ${leadIn}s ` +
            `and runs ${seconds - leadIn}s. Prompts arrive on their own.`
    );

    // Announce each phase as it begins. Timers rather than a loop, so the
    // prompts stay on schedule regardless of when fixes happen to arrive.
    let at = leadIn;
    for (const [index, phase] of WALK_PROTOCOL.entries()) {
        const startsAt = at;
        setTimeout(
            () => prompt(`[${index + 1}/${WALK_PROTOCOL.length}] ${phase.label}  (${phase.seconds}s)`),
            startsAt * 1000
        ).unref();
        at += phase.seconds;
    }
    setTimeout(() => prompt('DONE — you can stop and bring the tracker back in.'), at * 1000).unref();
}

try {
    for await (const event of listen(credentials, { signal: controller.signal })) {
        events += 1;
        const elapsed = (Date.now() - started) / 1000;
        // Fixes during the lead-in are warm-up, not part of any phase.
    const phase = guided ? phaseTag(elapsed - leadIn, WALK_PROTOCOL) : undefined;
        await appendFile(file, `${JSON.stringify({ received: Date.now(), phase, event })}\n`);

        if (HEARTBEAT_MESSAGES.has(event.message)) continue;

        const fix = tracker.apply(event);
        if (!fix) continue;

        const previous = fixes.at(-1);
        const moved = previous ? distance(previous.latlong, fix.latlong) : 0;
        const interval = previous ? fix.time - previous.time : 0;
        fixes.push(fix);

        detail(
            `${elapsed.toFixed(1).padStart(6)}s  ${fix.time}  ${String(interval).padStart(6)}s  ` +
                `${moved.toFixed(1).padStart(6)}m  ${String(fix.speed).padStart(5)}  ` +
                `${String(fix.accuracy).padStart(4)}  ${fix.sensor_used}`
        );
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

if (useLive) {
    detail('\nturning live tracking OFF...');
    await setLiveTracking(auth.token, trackerId, false);
}

detail(`\n${events} events, ${fixes.length} unique fixes → ${file}`);
detail(`analyse with:  node analyse.js ${file}`);
if (guided) prompt(`Recorded ${fixes.length} fixes. Live tracking is off.`);
