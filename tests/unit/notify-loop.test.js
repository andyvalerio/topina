/**
 * The afternoon it sent eighty-six notifications.
 *
 * 2026-09-21, 11:58 to 15:05. A manual hold was cleared and the state machine
 * entered a loop it could not leave: `sampling → out` announced an outing, the
 * stillness retraction withdrew it five to ten seconds later, `sampleIntervalS`
 * re-declared it three minutes after that, and round again. Forty-three times,
 * eighty-six pushes to a phone, while the cat was in fact outside the whole
 * time and going in and out as she pleased.
 *
 * Two independent faults, and both are asserted here because fixing either one
 * alone still leaves a monitor people learn to ignore:
 *
 * 1. **The retraction fired before the outing had run.** The stillness window
 *    is rolling, so by the time `out` was entered it was already full and
 *    already below threshold. "Half an hour of going nowhere" has to mean half
 *    an hour of *this outing* going nowhere.
 * 2. **Nothing rationed the buzz.** Being let out is news; being outside is
 *    not. The first announcement now opens a quiet period.
 *
 * `notify-loop.jsonl` is the real sequence, exported from the running service,
 * reduced to its `notify` and `phase` events — it carries no positions at all,
 * so there is nothing here to anonymise.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { announce, noQuiet } from '../../notifications.js';
import { DEFAULTS as OUTING, initial, step } from '../../outing.js';

const rows = readFileSync(new URL('../fixtures/notify-loop.jsonl', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

const notifications = rows.filter((r) => r.kind === 'notify');

test('the fixture is the loop it claims to be', () => {
    assert.equal(notifications.length, 86, 'eighty-six pushes');

    const kinds = notifications.reduce((acc, r) => {
        acc[r.data.kind] = (acc[r.data.kind] ?? 0) + 1;
        return acc;
    }, {});
    assert.deepEqual(kinds, { out: 43, still: 43 }, 'strictly alternating');

    const span = (notifications.at(-1).ts - notifications[0].ts) / 3600_000;
    assert.ok(span > 3 && span < 3.2, `over ${span.toFixed(1)} hours`);
});

test('the quiet period takes the afternoon down to a handful', () => {
    // Replayed through the real gate at the real timestamps.
    let quiet = noQuiet();
    const sent = [];

    for (const row of notifications) {
        const decision = announce(row.data.kind, quiet, OUTING, row.ts);
        quiet = decision.quiet;
        if (decision.send) sent.push(row.data.kind);
    }

    assert.ok(sent.length <= 4, `86 became ${sent.length}: ${sent.join(', ')}`);
    assert.ok(sent.length >= 1, 'but she did go out, and that is worth knowing once');
    assert.equal(sent[0], 'out', 'and the first thing heard is that she is out');
});

test('nothing goes quiet for longer than the setting', () => {
    // A quiet period that kept re-arming itself would be a mute button with
    // extra steps.
    let quiet = noQuiet();
    let last = null;
    const gaps = [];

    for (const row of notifications) {
        const decision = announce(row.data.kind, quiet, OUTING, row.ts);
        quiet = decision.quiet;
        if (!decision.send) continue;
        if (last !== null) gaps.push((row.ts - last) / 1000);
        last = row.ts;
    }

    for (const gap of gaps) {
        assert.ok(gap >= OUTING.notifyQuietS, `gap of ${gap}s is shorter than the quiet period`);
    }
});

test('an outing that has only just started cannot be retracted', () => {
    // The first fault, at its source. Five seconds into an outing, with a
    // rolling window that is full and still, the retraction must not fire.
    const T = 1_000_000_000_000;
    const input = (over) => ({
        nowMs: T,
        hour: 12,
        charging: false,
        batteryFull: false,
        freshFix: false,
        distanceM: null,
        movedM: null,
        movedRecentlyM: null,
        stillnessSettled: false,
        holdUntilMs: 0,
        holdLive: null,
        ...over,
    });

    let s = step(step(initial(), input({})), input({ nowMs: T + 9_000, freshFix: true, distanceM: 13 }));
    assert.equal(s.phase, 'out');

    const justStarted = step(s, input({
        nowMs: T + 14_000,
        freshFix: true,
        distanceM: 13,
        movedM: 1,
        stillnessSettled: true,
    }));
    assert.equal(justStarted.phase, 'out', 'five seconds is not half an hour of going nowhere');
    assert.equal(justStarted.notify, null);

    const hasRun = step(s, input({
        nowMs: T + 9_000 + OUTING.stillnessWindowS * 1000,
        freshFix: true,
        distanceM: 13,
        movedM: 1,
        stillnessSettled: true,
    }));
    assert.equal(hasRun.phase, 'waiting', 'but half an hour of it is');
    assert.equal(hasRun.notify, 'still');
});

test('trouble is never rationed by the comings and goings', () => {
    // The whole point of the thing. However noisy her wandering has been, a
    // real finding must still reach the phone.
    const busy = { lifecycle: 5_000_000_000_000, signal: 0 };
    const now = busy.lifecycle - 60_000;

    for (const kind of ['zone-entered', 'sprint', 'thrash']) {
        const decision = announce(kind, busy, OUTING, now);
        assert.equal(decision.send, true, `${kind} was held back`);
        assert.deepEqual(decision.quiet, busy, `${kind} should not move any quiet period`);
    }

    // Losing sight of her is rationed separately, and the first one always
    // gets through however long she has been wandering.
    assert.equal(announce('signal-lost', busy, OUTING, now).send, true);
});

test('losing and regaining signal cannot flap the phone', () => {
    // With quietS at 180s and fixes every ~200s, this pair alternates roughly
    // 36 times an hour. The first loss gets through; the rest do not.
    let quiet = noQuiet();
    const sent = [];
    const start = 1_000_000_000_000;
    let t = start;

    for (let i = 0; i < 40; i++) {
        for (const kind of ['signal-lost', 'signal-back']) {
            const decision = announce(kind, quiet, OUTING, t);
            quiet = decision.quiet;
            if (decision.send) sent.push(t);
            t += 200_000;
        }
    }

    assert.equal(sent[0], start, 'the first loss must always get through');

    // Ungated this is 80 pushes. The guarantee is a rate, not a count: at most
    // one per quiet period, however long the flapping goes on.
    const hours = (t - start) / 3600_000;
    const allowed = Math.ceil((t - start) / (OUTING.notifySignalQuietS * 1000)) + 1;
    assert.ok(
        sent.length <= allowed,
        `${hours.toFixed(1)}h of flapping sent ${sent.length}, allowed ${allowed}`
    );
    for (let i = 1; i < sent.length; i++) {
        assert.ok(sent[i] - sent[i - 1] >= OUTING.notifySignalQuietS * 1000);
    }
});

test('each kind can be silenced on its own', () => {
    const off = { ...OUTING, notifyOutEnabled: false, notifyStillEnabled: false };

    assert.equal(announce('out', noQuiet(), off, 1000).send, false);
    assert.equal(announce('still', noQuiet(), off, 1000).send, false);
    assert.equal(announce('signal-lost', noQuiet(), off, 1000).send, true, 'trouble is not a preference');

    // Silencing one must not open a quiet period that muffles the others.
    assert.deepEqual(announce('out', noQuiet(), off, 1000).quiet, noQuiet());
});

test('home is off by default, and still switchable back on', () => {
    // She is in and out all day, so announcing every return carries the same
    // noise as announcing every departure.
    assert.equal(announce('home', noQuiet(), OUTING, 1000).send, false);
    assert.equal(announce('home', noQuiet(), { ...OUTING, notifyHomeEnabled: true }, 1000).send, true);
});
