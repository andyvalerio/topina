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
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { session } from './auth.js';
import { setLiveTracking } from './commands.js';
import { getGeofence, getGeofences, getPet } from './rest.js';
import { createTracker } from './state.js';
import { computeSignals, createWindow, staleness } from './signals.js';
import { createDisplacement } from './displacement.js';
import { createDetector, DEFAULTS, DESCRIBED as DETECTOR_HELP } from './detectors.js';
import { timeRange } from './query.js';
import { DEFAULTS as OUTING, DESCRIBED as OUTING_HELP, initial, step } from './outing.js';
import { open as openDb } from './db.js';
import { createZoneWatcher, escalate, tighten } from './zones.js';
import { createIncidents } from './incidents.js';
import { fileSource, liveSource } from './sources.js';
import { numericOption } from './phases.js';
import { createNotifier } from './notify.js';
import { createAlerter } from './alerts.js';
import { batteryStepCrossed, forBattery, forFindings, forOuting } from './notifications.js';
import { dayKey, due as heartbeatDue, message as heartbeatMessage } from './heartbeat.js';
import { credentials, fcm, missing, petId, petName, trackerId } from './config.js';

const args = process.argv.slice(2);
const replayPath = args.includes('--replay') ? args[args.indexOf('--replay') + 1] : null;
const pace = numericOption(args, '--pace', 0);
const useLive = !replayPath && !args.includes('--no-live');
const port = numericOption(args, '--port', Number(process.env.PORT) || 8080);

/**
 * Where to keep the raw event log, or nothing to keep none (**F4**, **D7**).
 * Off by default: in a container without a volume behind it, recording would
 * fill the writable layer and be lost on restart anyway.
 */
/**
 * Settings, state and events. Seeded once from defaults and the environment,
 * after which the stored value wins — so changing an environment variable
 * later does nothing, which is why each setting remembers its source.
 */
const db = openDb(process.env.DB_PATH || 'data/topina.db');

/** sampleIntervalS → SAMPLE_INTERVAL_S */
const envName = (key) => key.replace(/([A-Z])/g, '_$1').toUpperCase();

for (const [key, value] of Object.entries({ ...OUTING, ...DEFAULTS })) {
    const override = process.env[envName(key)];
    if (override === undefined) db.seed(key, value, 'default');
    else db.seed(key, JSON.parse(override), 'env');
}

/** @param {object} defaults */
const configured = (defaults) =>
    Object.fromEntries(Object.keys(defaults).map((k) => [k, db.get(k) ?? defaults[k]]));

const recordDir = process.env.RECORD_DIR || null;
if (recordDir) await mkdir(recordDir, { recursive: true });
const recordFile = recordDir
    ? `${recordDir}/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
    : null;

/**
 * Frames kept so a browser opening later sees history rather than a blank
 * chart. Sized for the longest window the dashboard offers.
 */
const HISTORY = 1500;

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

const server = createServer((req, res) => {
    // Nothing below may take the process down. Without this, any throw in any
    // endpoint kills the monitor outright — found by GET /export?from=abc.
    handle(req, res).catch((err) => {
        console.error(`request failed: ${req.method} ${req.url} — ${err.message}`);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        if (!res.writableEnded) res.end('internal error');
    });
});

async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/stream') {
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

    if (url.pathname === '/live' && req.method === 'POST') {
        // Manual control. The hold outranks the state machine until it
        // expires, then control returns to automatic (**L5**).
        const on = url.searchParams.get('on') === 'true';
        const minutes = Number(url.searchParams.get('minutes') || 30);
        hold = { untilMs: Date.now() + minutes * 60_000, live: on };
        db.saveState('hold', hold);
        db.record('hold', hold);

        // Turning live *off* while the service insists she is out is not a
        // preference — it is a correction. Someone can see she is indoors and
        // the monitor cannot. That is the only ground truth this system ever
        // gets about its own false positives, and it used to be thrown away:
        // on 2026-09-21 exactly this happened at 07:16, the hold was cleared
        // at 07:21, and the same false outing reopened ten seconds later
        // having learned nothing.
        //
        // Stored with the evidence as it stood, so the thresholds above can
        // one day be set from these instead of from a week of her movement
        // that never contained a known-bad case.
        if (!on && (outing.phase === 'out' || outing.phase === 'signal-lost')) {
            const snapshot = tracker.snapshot();
            db.record('false-positive', {
                phase: outing.phase,
                outingSinceMs: outing.since,
                fromHome: lastSignals?.fromHome ?? null,
                displacementM: lastSignals?.displacementM ?? null,
                stillnessM: stillness.value().displacementM,
                stillnessSettled: stillness.settled(),
                battery: snapshot.hardware?.battery_level ?? null,
                chargingState: snapshot.charging_state ?? null,
                batteryState: snapshot.battery_state ?? null,
                docked: outing.docked ?? false,
            });
            console.log('recorded a false positive: live held off while phase was ' + outing.phase);
        }

        console.log(`manual hold: live ${on ? 'on' : 'off'} for ${minutes} min`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hold, phase: outing.phase }));
        return;
    }

    if (url.pathname === '/live' && req.method === 'DELETE') {
        hold = { untilMs: 0, live: null };
        db.saveState('hold', hold);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hold, phase: outing.phase }));
        return;
    }

    if (url.pathname === '/settings' && req.method === 'GET') {
        const help = { ...OUTING_HELP, ...DETECTOR_HELP };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db.settings().map((s) => ({ ...s, help: help[s.key] ?? '' }))));
        return;
    }

    if (url.pathname === '/settings' && req.method === 'POST') {
        const key = url.searchParams.get('key');
        const raw = url.searchParams.get('value');
        if (!key || raw === null) {
            res.writeHead(400).end('key and value required');
            return;
        }
        db.set(key, JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db.settings()));
        return;
    }

    if (url.pathname === '/events') {
        // Export for offline analysis: any window, raw.
        const { from, to } = timeRange(url.searchParams, 86400_000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db.events(from, to)));
        return;
    }

    if (url.pathname === '/incidents' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ open: incidents.current(), past: db.incidents(50) }));
        return;
    }

    if (url.pathname === '/incidents' && req.method === 'POST') {
        // Saying which were real is what turns provisional thresholds into
        // measured ones. Analysis happens elsewhere; this is just the label.
        const id = Number(url.searchParams.get('id'));
        const label = url.searchParams.get('label') ?? '';
        if (!id) {
            res.writeHead(400).end('id required');
            return;
        }
        db.labelIncident(id, label);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(db.incidents(50)));
        return;
    }

    if (url.pathname === '/export') {
        // A window of raw events, for looking at offline. The dashboard is
        // not an analysis workbench and should not try to be.
        const { from, to } = timeRange(url.searchParams, 3600_000);
        const rows = db.events(from, to);
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Content-Disposition': `attachment; filename="topina-${new Date(from).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jsonl"`,
        });
        res.end(rows.map((r) => JSON.stringify(r)).join('\n'));
        return;
    }

    if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                outing,
                hold,
                commandsEnabled: useLive,
                config: configured(OUTING),
                live: tracker.snapshot().live_tracking ?? null,
            })
        );
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
}

server.listen(port, () => {
    console.log(`dashboard on http://localhost:${port}`);
    if (replayPath) console.log(`replaying ${replayPath}${pace ? ` at ${pace}x` : ' as fast as possible'}`);
});

let home = null;
let auth = null;

// Declared before the startup block that fills it: that block runs at the top
// level, so anything it touches must already exist.
/** @type {object[]} */
const dangerZones = [];
const zoneWatcher = createZoneWatcher(configured(OUTING).dangerDwellFixes);

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
    // Danger zones come from the account, where the user drew and named them.
    try {
        const stubs = await getGeofences(auth.token, trackerId);
        for (const stub of Array.isArray(stubs) ? stubs : []) {
            const fence = await getGeofence(auth.token, stub._id);
            if (fence?.fence_type === 'DANGER' && fence.active) dangerZones.push(fence);
        }
        console.log(
            dangerZones.length
                ? `danger zones: ${dangerZones.map((f) => f.name).join(', ')}`
                : 'danger zones: none'
        );
    } catch (err) {
        console.error('could not read geofences:', err.message);
    }

    if (useLive) await setLiveTracking(auth.token, trackerId, true);
}

const controller = new AbortController();
const tracker = createTracker();
const window = createWindow();

/**
 * A much longer view of where she has been, for the one question a minute
 * cannot answer: has anything moved at all in the last half hour. This is
 * what retracts an outing that only ever existed because a tracker on its
 * charger kept emitting fixes (**C41**).
 */
const stillness = createDisplacement(configured(OUTING).stillnessWindowS);

/**
 * The short view, for how quickly the docked latch can open.
 *
 * Its own window rather than the one `signals.js` keeps, even though both
 * default to 60 seconds. That one is the basis of the thrash ratio, so making
 * it a tuning knob for the latch would move a detector as a side effect of
 * changing an outing setting.
 */
const reaction = createDisplacement(configured(OUTING).reactionWindowS);
const detector = createDetector(configured(DEFAULTS));
const incidents = createIncidents();
incidents.restore(db.loadState('incident'));
const alerter = createAlerter();

// Push is optional. Without a device token the service still watches and
// still serves the dashboard — it just cannot reach a phone.
const notifier = fcm.deviceToken
    ? createNotifier({ keyPath: fcm.keyPath, deviceToken: fcm.deviceToken })
    : null;
console.log(notifier ? 'push: enabled' : 'push: disabled (no FCM_TOKEN)');

/** What every notification needs to stand alone away from home. */
const notificationContext = () => ({
    petName,
    distanceM: lastSignals?.fromHome ?? null,
    latlong: lastSignals?.latlong ?? null,
    battery: tracker.snapshot().hardware?.battery_level ?? null,
    zone: currentZone,
});

/**
 * Send one composed message. A failed notification must never take the
 * monitor down with it.
 * @param {{title: string, body: string, tier: string, url: string}} message
 */
async function push(message) {
    if (!notifier) return;
    try {
        const result = await notifier.send({
            title: message.title,
            body: message.body,
            urgent: message.tier === 'alarm',
            url: message.url,
        });
        console.log(result.ok ? `pushed [${message.tier}]: ${message.title}` : `push failed: ${result.detail}`);
    } catch (err) {
        console.error('push error:', err.message);
    }
}

/**
 * Send anything newly worth waking someone for.
 * @param {{code: string, level: string, detail: string}[]} findings
 */
async function notify(findings) {
    const urgent = findings.filter((f) => f.level === 'alarm');
    const due = alerter.due(urgent, Date.now());
    if (due.length) await push(forFindings(due, notificationContext()));
}

let lastArrivalMs = Date.now();
let lastSignals = null;
let lastCommandMs = 0;
let lastBattery = /** @type {number|null} */ (null);
let currentZone = /** @type {string|null} */ (null);
let sawFreshFix = false;
// Restored rather than reset: a service restarted mid-outing must still know
// she is outside, or it quietly stops watching her.
let outing = db.loadState('outing') ?? initial();
let hold = db.loadState('hold') ?? { untilMs: 0, live: /** @type {boolean|null} */ (null) };
if (outing.phase === 'out' || outing.phase === 'signal-lost') {
    console.log(`restored mid-outing: ${outing.phase}`);
}

/**
 * Drive live tracking from the outing state machine.
 *
 * Re-arming falls out of this for free: the device drops live after its own
 * 1800s timeout (**C11**), the snapshot reports it as inactive, and the next
 * tick simply asks for it again. There is no separate re-arm path to forget.
 */
async function tick() {
    if (replayPath) return;

    const snapshot = tracker.snapshot();
    const live = snapshot.live_tracking ?? {};

    // Both windows are settings, so both can change under a running service.
    // Applied here rather than at the edit, so there is one place that knows
    // the windows exist and no path that can forget to.
    const spans = configured(OUTING);
    stillness.resize(spans.stillnessWindowS);
    reaction.resize(spans.reactionWindowS);

    const drift = stillness.value();

    const next = step(
        outing,
        {
            nowMs: Date.now(),
            hour: new Date().getHours(),
            charging: snapshot.charging_state === 'CHARGING',
            // The charger stops charging at 100% and the state flips back to
            // NOT_CHARGING, so this is the only thing left saying "full and
            // sitting on the dock" (**C40**).
            batteryFull: snapshot.battery_state === 'FULL',
            freshFix: sawFreshFix,
            distanceM: lastSignals?.fromHome ?? null,
            movedM: drift.displacementM,
            movedRecentlyM: reaction.value().displacementM,
            stillnessSettled: stillness.settled(),
            holdUntilMs: hold.untilMs,
            holdLive: hold.live,
        },
        configured(OUTING)
    );
    sawFreshFix = false;

    if (next.phase !== outing.phase) {
        console.log(`outing: ${outing.phase} → ${next.phase}`);
        db.record('phase', { from: outing.phase, to: next.phase, distanceM: next.lastDistanceM });
    }
    outing = next;
    db.saveState('outing', outing);

    if (useLive && auth && !live.pending && Date.now() - lastCommandMs > 30_000) {
        if (next.live && !live.active) {
            lastCommandMs = Date.now();
            console.log('live tracking on');
            await setLiveTracking(auth.token, trackerId, true).catch((e) =>
                console.error('live on failed:', e.message)
            );
        } else if (!next.live && live.active) {
            lastCommandMs = Date.now();
            console.log('live tracking off');
            await setLiveTracking(auth.token, trackerId, false).catch((e) =>
                console.error('live off failed:', e.message)
            );
        }
    }

    if (next.notify) db.record('notify', { kind: next.notify, distanceM: next.lastDistanceM });

    if (next.notify) void push(forOuting(next.notify, notificationContext()));

    // One message a day, so the silence of a dead service is noticeable.
    // Everything else about this system is invisible when it fails.
    const settings = configured(OUTING);
    if (settings.heartbeatEnabled) {
        const now = new Date();
        const today = dayKey(now);
        if (heartbeatDue({ hour: now.getHours(), day: today }, db.loadState('heartbeatDay'), settings.heartbeatHour)) {
            db.saveState('heartbeatDay', today);
            void push(
                heartbeatMessage({
                    petName,
                    battery: snapshot.hardware?.battery_level ?? null,
                    phase: next.phase,
                    incidentsToday: db.incidents(50).filter((i) => i.startedAt >= Date.now() - 86400_000).length,
                })
            );
        }
    }

    // Battery, each time it falls past a step. Only while she is off the
    // dock — a tracker sitting on its charger dropping a percent is not news.
    // `charging_state` alone was not enough to know that: it reads
    // NOT_CHARGING at a full battery, which is how a docked tracker managed
    // to drain 100% to 96% inside the reporting path on 2026-09-21 (**C40**).
    const battery = snapshot.hardware?.battery_level ?? null;
    if (battery !== null && !next.docked) {
        const crossed = batteryStepCrossed(lastBattery, battery, configured(OUTING).batteryStepPercent);
        if (crossed !== null) void push(forBattery(crossed, petName));
        lastBattery = battery;
    } else if (battery !== null) {
        lastBattery = battery;
    }

    broadcast({
        receivedMs: lastArrivalMs,
        outing: next,
        hold,
        live: live.active ?? false,
        // Without this the dashboard shows a phase and a hold while being
        // structurally unable to send a command, which looks identical to
        // working.
        commandsEnabled: useLive,
        signals: lastSignals ?? emptySignals(),
        level: 'calm',
        findings: [],
        pending: [],
        petName,
        battery,
        chargingState: snapshot.charging_state ?? null,
        batteryState: snapshot.battery_state ?? null,
        docked: next.docked,
        stillnessM: drift.displacementM,
    });
}

const ticker = setInterval(tick, 5000);

/** Keep the store from growing without bound. Incidents are never pruned. */
function prune() {
    const days = configured(OUTING).retentionDays;
    const before = db.countEvents();
    db.prune(Date.now() - days * 86400_000);
    const after = db.countEvents();
    if (before !== after) console.log(`pruned ${before - after} events older than ${days} days`);
}
prune();
const pruner = setInterval(prune, 86400_000);
pruner.unref();

let stopping = false;

/**
 * Stop cleanly, and above all leave the tracker alone.
 *
 * Kubernetes stops a pod with SIGTERM, so every restart runs this. Getting it
 * wrong means live tracking is left on and the battery drains until something
 * else turns it off (**C29**) — which is exactly what happened before this was
 * written properly.
 *
 * Three things previously went wrong and are each guarded here: the handler
 * referenced a variable that no longer existed and threw on its first line;
 * `fetch` has no timeout, so turning live off could hang forever; and
 * `server.close()` waits for open connections, of which the SSE clients never
 * close on their own.
 */
async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} — stopping`);

    // Whatever else happens, do not hang around.
    const deadline = setTimeout(() => {
        console.error('shutdown timed out, exiting anyway');
        process.exit(1);
    }, 10_000);
    deadline.unref();

    clearInterval(ticker);
    controller.abort();

    if (useLive && auth) {
        try {
            console.log('turning live tracking off...');
            await Promise.race([
                setLiveTracking(auth.token, trackerId, false),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 5_000)),
            ]);
            console.log('live tracking off');
        } catch (err) {
            // Worth shouting about: the tracker may be left draining.
            console.error(`COULD NOT TURN LIVE TRACKING OFF: ${err.message}`);
        }
    }

    // SSE responses are long-lived by design and would hold close() open.
    for (const client of clients) client.destroy();
    server.close();

    clearTimeout(deadline);
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const source = replayPath
    ? fileSource(replayPath, { pace })
    : liveSource(credentials, { signal: controller.signal });

try {
    for await (const { receivedMs, event, phase } of source) {
        lastArrivalMs = receivedMs;

        if (recordFile) {
            // Best effort: losing the tuning corpus is a nuisance, losing the
            // monitor is the actual failure.
            appendFile(recordFile, `${JSON.stringify({ received: receivedMs, event })}\n`).catch(
                (err) => console.error('record failed:', err.message)
            );
        }

        const fix = tracker.apply(event);
        if (!fix) continue;
        sawFreshFix = true;
        const snapshot = tracker.snapshot();

        stillness.add(fix);
        reaction.add(fix);
        const signals = computeSignals({
            fix,
            window: window.add(fix),
            home,
            lastArrivalMs,
            nowMs: replayPath ? receivedMs : Date.now(),
        });
        lastSignals = signals;

        // Inside the rival's patch the same behaviour means more, so the
        // thresholds tighten and findings escalate a tier. Being there is not
        // itself an alarm — she is in there 7% of the time.
        const settings = configured(OUTING);
        const zone = settings.dangerZoneEnabled
            ? zoneWatcher.update(fix.latlong, dangerZones)
            : { inside: false, entered: false, left: false, fence: null };

        currentZone = zone.inside ? zone.fence?.name ?? 'danger zone' : null;
        if (zone.entered) {
            console.log(`entered danger zone: ${zone.fence?.name}`);
            db.record('zone-entered', { name: zone.fence?.name });
            if (!replayPath) void push(forOuting('zone-entered', notificationContext()));
        }
        if (zone.left) db.record('zone-left', null);

        const thresholds = zone.inside
            ? tighten(configured(DEFAULTS), settings.dangerFactor)
            : configured(DEFAULTS);

        // Nothing that happens to a tracker on its charging dock is news, and
        // this is where that has to be enforced: the detectors run on every
        // fix that arrives, whatever the outing phase says, so the docked
        // latch on its own would still have let the charging hour raise its
        // three alarms. Judging her by a tracker that is not on her is the
        // root of every false reading that morning (**C41**).
        //
        // The fix is still recorded and still broadcast — the evidence is
        // worth keeping and the dashboard should show what is arriving. Only
        // the judgement is withheld.
        const raw = outing.docked
            ? { level: /** @type {'calm'} */ ('calm'), findings: [], pending: [] }
            : detector.assess(signals, thresholds);
        const verdict = zone.inside && !outing.docked
            ? { ...raw, findings: escalate(raw.findings), level: raw.findings.length ? 'alarm' : raw.level }
            : raw;

        if (!replayPath) void notify(verdict.findings);

        // An incident is the thing that happened, as opposed to the readings
        // it happened across. Findings vanish with their reading; this is what
        // can be reviewed and labelled afterwards.
        // Every fix goes into the same store as everything else, with the
        // signals and the verdict alongside it. An export that contained only
        // the decisions and not the evidence would be the wrong half.
        if (!replayPath) {
            db.record(
                'fix',
                {
                    time: fix.time,
                    latlong: fix.latlong,
                    accuracy: fix.accuracy,
                    sensor: fix.sensor_used,
                    speed: signals.speed,
                    moved: signals.moved,
                    interval: signals.interval,
                    thrash: signals.thrash,
                    displacementM: signals.displacementM,
                    fromHome: signals.fromHome,
                    zone: currentZone,
                    level: verdict.level,
                    findings: verdict.findings.map((f) => f.code),
                    phase: outing.phase,
                    battery: snapshot.hardware?.battery_level ?? null,
                },
                receivedMs
            );
        }

        const inc = incidents.update({
            findings: verdict.findings,
            signals,
            zone: currentZone,
            nowMs: receivedMs,
        });
        db.saveState('incident', incidents.current());
        if (inc.opened) console.log(`incident opened: ${inc.opened.codes.join(', ')}`);
        if (inc.closed) {
            db.addIncident(inc.closed);
            const seconds = Math.round((inc.closed.endedAt - inc.closed.startedAt) / 1000);
            console.log(`incident closed after ${seconds}s: ${inc.closed.codes.join(', ')}`);
        }

        broadcast({
            receivedMs,
            signals,
            ...verdict,
            zone: zone.inside ? zone.fence?.name ?? 'danger zone' : null,
            phase,
            petName,
            battery: snapshot.hardware?.battery_level ?? null,
            trackerState: snapshot.tracker_state ?? null,
            // Both of these were invisible while a tracker on its charger was
            // reported as being out for an entire morning. A dashboard that
            // cannot show why the service thinks she is outside cannot be
            // used to catch it thinking wrongly (**D5**).
            chargingState: snapshot.charging_state ?? null,
            batteryState: snapshot.battery_state ?? null,
            docked: outing.docked ?? false,
            stillnessM: stillness.value().displacementM,
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
        displacementM: null,
        fromHome: null,
        accuracy: null,
        sensor: null,
    };
}


