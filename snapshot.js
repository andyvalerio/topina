/**
 * A self-contained replay of a recording.
 *
 * Runs a recording through the real pipeline, embeds the resulting frames in
 * a copy of the dashboard, and writes a single HTML file that replays them
 * client-side. No server, no network — it can be opened anywhere, which makes
 * it the way to look at a session from a phone, or to show someone what
 * happened without handing them a checkout.
 *
 *   node snapshot.js data/<recording>.jsonl [out.html]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createTracker } from './state.js';
import { computeSignals, createWindow } from './signals.js';
import { createDetector } from './detectors.js';
import { fileSource } from './sources.js';
import { petName } from './config.js';

const [source, out = 'data/replay.html'] = process.argv.slice(2);
if (!source) {
    console.error('usage: node snapshot.js data/<recording>.jsonl [out.html]');
    process.exit(1);
}

const tracker = createTracker();
const window = createWindow();
const detector = createDetector();
const frames = [];

for await (const { receivedMs, event, phase } of fileSource(source)) {
    const fix = tracker.apply(event);
    if (!fix) continue;

    const signals = computeSignals({
        fix,
        window: window.add(fix),
        lastArrivalMs: receivedMs,
        nowMs: receivedMs,
    });
    const snapshot = tracker.snapshot();
    frames.push({
        receivedMs,
        signals,
        ...detector.assess(signals),
        phase,
        petName,
        battery: snapshot.hardware?.battery_level ?? null,
    });
}

const page = await readFile('dashboard.html', 'utf8');

// Swap the live SSE feed for the embedded frames, replayed against a clock
// that starts at the recording's first frame so the chart window lines up.
const replayScript = `
const FRAMES = ${JSON.stringify(frames)};
const T0 = FRAMES[0].receivedMs;
const SPAN = FRAMES.at(-1).receivedMs - T0;
let playHead = 0;
Date.now = () => T0 + playHead;
setInterval(() => {
  playHead += 250;
  if (playHead > SPAN + 30000) playHead = 0;
  frames.length = 0;
  frames.push(...FRAMES.filter(f => f.receivedMs <= T0 + playHead));
}, 250);
`;

const replayed = page.replace(
    /const stream = new EventSource\('\/events'\);[\s\S]*?};/,
    replayScript
);

await writeFile(out, replayed);
console.log(`${frames.length} frames → ${out}`);
