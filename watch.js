/**
 * Step 5: derived signals, live.
 *
 * Turns the event stream into a continuously updating picture of what is
 * happening now. No thresholds and no alerting — the point is to make the
 * numbers visible so they can be watched next to a real cat, which is the only
 * way to learn what they mean.
 *
 *   npm run watch                      live, with live tracking on
 *   npm run watch -- --no-live         live, without touching the device
 *   npm run watch -- --replay data/x.jsonl [--pace 10]
 *
 * Reference points from the measured walk: standing still never exceeded
 * 0.23 m/s, walking ran about 1.0 m/s, jogging 1.5 m/s.
 */
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { getPet } from './rest.js';
import { createTracker } from './state.js';
import { computeSignals, createWindow, staleness } from './signals.js';
import { fileSource, liveSource } from './sources.js';
import { numericOption } from './phases.js';
import { credentials, missing, petId, petName, trackerId } from './config.js';

const args = process.argv.slice(2);
const replayPath = args.includes('--replay') ? args[args.indexOf('--replay') + 1] : null;
const pace = numericOption(args, '--pace', 0);
const useLive = !replayPath && !args.includes('--no-live');

/** Report silence at most this often, so a quiet cat does not scroll the screen. */
const SILENCE_REPORT_S = 15;

let home = null;
let auth = null;

if (!replayPath) {
    const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
    if (blocked) {
        console.error(blocked);
        process.exit(1);
    }

    auth = await session(credentials);

    // One call at startup: home_location is what distance-from-home is
    // measured against, and it does not move.
    if (petId) {
        const pet = await getPet(auth.token, petId);
        home = Array.isArray(pet?.home_location) ? pet.home_location : null;
    }

    if (useLive) await setLiveTracking(auth.token, trackerId, true);
}

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const tracker = createTracker();
const window = createWindow();
let lastArrivalMs = Date.now();
let lastSilenceReport = 0;

// Staleness is the absence of events, so nothing in the stream can trigger
// its recalculation. It needs its own heartbeat (C_staleness).
const ticker = setInterval(() => {
    const quiet = staleness(lastArrivalMs, Date.now());
    if (quiet >= SILENCE_REPORT_S && quiet - lastSilenceReport >= SILENCE_REPORT_S) {
        lastSilenceReport = quiet;
        console.log(`${pad(' ')}  no data for ${quiet.toFixed(0)}s`);
    }
}, 1000);
ticker.unref?.();

console.log(`watching ${petName}${replayPath ? ` — replay of ${replayPath}` : ''}`);
console.log(home ? `home reference: set` : 'home reference: unavailable (distance from home disabled)');
console.log('\n  speed   moved  intvl  thrash   home   acc  sensor  phase');

const source = replayPath
    ? fileSource(replayPath, { pace })
    : liveSource(credentials, { signal: controller.signal });

try {
    for await (const { receivedMs, event, phase } of source) {
        lastArrivalMs = receivedMs;
        lastSilenceReport = 0;

        const fix = tracker.apply(event);
        if (!fix) continue;

        const signals = computeSignals({
            fix,
            window: window.add(fix),
            home,
            lastArrivalMs,
            nowMs: replayPath ? receivedMs : Date.now(),
        });

        console.log(
            [
                num(signals.speed, 2, 6),
                num(signals.moved, 1, 7),
                num(signals.interval, 0, 6),
                num(signals.thrash, 1, 7),
                num(signals.fromHome, 0, 6),
                num(signals.accuracy, 0, 5),
                String(signals.sensor ?? '-').padStart(7),
                `  ${phase ?? ''}`,
            ].join(' ')
        );
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
} finally {
    clearInterval(ticker);
    if (useLive && auth) {
        console.log('\nturning live tracking off...');
        await setLiveTracking(auth.token, trackerId, false);
    }
}

/** @param {number|null} value */
function num(value, places, width) {
    return (value === null || value === undefined ? '-' : value.toFixed(places)).padStart(width);
}

function pad(s) {
    return s.padStart(6);
}
