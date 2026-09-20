/**
 * The dashboard service.
 *
 * Holds the channel open, computes signals, runs the detectors, and pushes
 * every frame to any browser watching. Also serves the page itself, so the
 * whole thing is one process with no build step and no dependencies.
 *
 *   npm start                                  live
 *   npm start -- --no-live                     live, without touching the device
 *   npm start -- --replay data/x.jsonl --pace 1
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { getPet } from './rest.js';
import { createTracker } from './state.js';
import { computeSignals, createWindow, staleness } from './signals.js';
import { createDetector, DEFAULTS } from './detectors.js';
import { fileSource, liveSource } from './sources.js';
import { numericOption } from './phases.js';
import { credentials, missing, petId, petName, trackerId } from './config.js';

const args = process.argv.slice(2);
const replayPath = args.includes('--replay') ? args[args.indexOf('--replay') + 1] : null;
const pace = numericOption(args, '--pace', 0);
const useLive = !replayPath && !args.includes('--no-live');
const port = numericOption(args, '--port', 8080);

/** Frames kept so a browser opening later sees history rather than a blank chart. */
const HISTORY = 600;

const history = [];
const clients = new Set();
let latest = null;

/** @param {object} frame */
function broadcast(frame) {
    latest = frame;
    history.push(frame);
    if (history.length > HISTORY) history.shift();

    const payload = `data: ${JSON.stringify(frame)}\n\n`;
    for (const client of clients) client.write(payload);
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        // Replay the buffer so the chart is populated immediately.
        res.write(`data: ${JSON.stringify({ type: 'history', frames: history })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    if (url.pathname === '/health') {
        // Healthy means data is arriving, not merely that the process is up:
        // a monitor that has silently stopped monitoring is the failure worth
        // catching, and process liveness would not catch it (D5).
        const quiet = latest ? staleness(latest.receivedMs, Date.now()) : Infinity;
        const healthy = quiet < DEFAULTS.silenceS;
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ healthy, secondsSinceData: quiet === Infinity ? null : quiet }));
        return;
    }

    try {
        const page = await readFile(new URL('./dashboard.html', import.meta.url));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
    } catch {
        res.writeHead(404).end('not found');
    }
});

server.listen(port, () => {
    console.log(`dashboard on http://localhost:${port}`);
    if (replayPath) console.log(`replaying ${replayPath}${pace ? ` at ${pace}x` : ' as fast as possible'}`);
});

let home = null;
let auth = null;

if (!replayPath) {
    const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
    if (blocked) {
        console.error(blocked);
        process.exit(1);
    }
    auth = await session(credentials);
    if (petId) {
        const pet = await getPet(auth.token, petId);
        home = Array.isArray(pet?.home_location) ? pet.home_location : null;
    }
    if (useLive) await setLiveTracking(auth.token, trackerId, true);
}

const controller = new AbortController();
const tracker = createTracker();
const window = createWindow();
const detector = createDetector();

let lastArrivalMs = Date.now();
let lastSignals = null;

// Staleness is the absence of events, so nothing in the stream can trigger its
// recalculation. Its own heartbeat also keeps the chart moving while quiet.
const ticker = setInterval(() => {
    if (replayPath) return;
    const quiet = staleness(lastArrivalMs, Date.now());
    const signals = { ...(lastSignals ?? emptySignals()), staleness: quiet };
    const verdict = detector.assess(signals);
    broadcast({ receivedMs: lastArrivalMs, tick: true, signals, ...verdict, petName });
}, 1000);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const source = replayPath
    ? fileSource(replayPath, { pace })
    : liveSource(credentials, { signal: controller.signal });

try {
    for await (const { receivedMs, event, phase } of source) {
        lastArrivalMs = receivedMs;

        const fix = tracker.apply(event);
        if (!fix) continue;

        const signals = computeSignals({
            fix,
            window: window.add(fix),
            home,
            lastArrivalMs,
            nowMs: replayPath ? receivedMs : Date.now(),
        });
        lastSignals = signals;

        const snapshot = tracker.snapshot();
        broadcast({
            receivedMs,
            signals,
            ...detector.assess(signals),
            phase,
            petName,
            battery: snapshot.hardware?.battery_level ?? null,
            trackerState: snapshot.tracker_state ?? null,
        });
    }
} catch (err) {
    if (err.name !== 'AbortError') throw err;
}

if (replayPath) console.log('replay finished — dashboard still serving');

function emptySignals() {
    return {
        speed: null,
        moved: null,
        interval: null,
        thrash: null,
        fromHome: null,
        accuracy: null,
        sensor: null,
    };
}

async function shutdown() {
    clearInterval(ticker);
    controller.abort();
    if (useLive && auth) {
        console.log('\nturning live tracking off...');
        await setLiveTracking(auth.token, trackerId, false);
    }
    server.close();
    process.exit(0);
}
