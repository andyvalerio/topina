/**
 * Derived signals.
 *
 * Everything here is pure: given fixes in, numbers out. No clock, no network,
 * no state of its own — `now` is passed in so the same code drives a live
 * connection and a replayed recording, and so the maths can be tested without
 * either.
 *
 * Two clocks are in play and they must never meet in one subtraction
 * (**C14**). Anything measuring *between fixes* uses the tracker's `time`.
 * Staleness — how long since we last heard anything — is the one thing the
 * tracker's clock cannot answer, since silence produces no timestamp, so it
 * uses ours.
 */
import { distance } from './geo.js';
import { centreDisplacement } from './displacement.js';

/** How much trailing history the windowed signals look at. */
export const WINDOW_S = 60;

/**
 * Above this, the tracker is genuinely moving rather than sitting in its own
 * noise. Measured: standing still never exceeded 0.23 m/s and walking slowly
 * ran 0.69, so 0.4 sits in the gap with room on both sides.
 */
export const MOVING_MS = 0.4;

/**
 * Speed between two consecutive fixes, in metres per second.
 *
 * Deliberately unsmoothed. The device already smooths — reported position
 * trails real motion by about 8 seconds (**C22**) — and averaging on top of
 * that would push detection further behind reality for no gain in clarity.
 *
 * @param {{latlong: [number, number], time: number}} from
 * @param {{latlong: [number, number], time: number}} to
 * @returns {number|null} null when the interval is not positive
 */
export function speedBetween(from, to) {
    const interval = to.time - from.time;
    if (!(interval > 0)) return null;
    return distance(from.latlong, to.latlong) / interval;
}

/**
 * How much of the movement in a window went anywhere.
 *
 * Path length divided by net displacement. A cat walking in a line scores
 * near 1; one going back and forth over the same few metres scores high.
 * That is the shape of a scuffle or of being circled — moving hard, arriving
 * nowhere.
 *
 * **Only meaningful while actually moving.** A stationary tracker's jitter
 * accumulates path length while going nowhere, which scores exactly like a
 * scuffle — replaying a real recording showed standing still rating 2.4-3.4
 * and walking rating 1.3-1.6, the opposite of useful. So the ratio is gated
 * on average speed across the window clearing the noise floor; below that it
 * reports nothing rather than something misleading.
 *
 * Proof of concept: the value that means "trouble" is still unknown.
 *
 * @param {{latlong: [number, number], time: number}[]} fixes oldest first
 * @returns {number|null}
 */
export function thrashRatio(fixes) {
    if (fixes.length < 3) return null;

    let path = 0;
    for (let i = 1; i < fixes.length; i++) {
        path += distance(fixes[i - 1].latlong, fixes[i].latlong);
    }

    const span = fixes.at(-1).time - fixes[0].time;
    if (!(span > 0) || path / span < MOVING_MS) return null;

    const net = distance(fixes[0].latlong, fixes.at(-1).latlong);

    // Net displacement below the noise floor is noise divided by noise.
    if (net < 1) return null;

    return path / net;
}

/**
 * Seconds since anything last arrived, on our clock.
 *
 * The dead-man's signal. It cannot be event-driven — the thing it measures is
 * the absence of events — so whatever displays it must recompute on a timer.
 *
 * @param {number} lastArrivalMs epoch milliseconds
 * @param {number} nowMs epoch milliseconds
 * @returns {number}
 */
export function staleness(lastArrivalMs, nowMs) {
    return Math.max(0, (nowMs - lastArrivalMs) / 1000);
}

/**
 * A rolling window of recent fixes, trimmed by the tracker's own clock.
 * @param {number} [seconds]
 */
export function createWindow(seconds = WINDOW_S) {
    /** @type {{latlong: [number, number], time: number}[]} */
    let fixes = [];

    return {
        /** @param {{latlong: [number, number], time: number}} fix */
        add(fix) {
            fixes.push(fix);
            const cutoff = fix.time - seconds;
            fixes = fixes.filter((f) => f.time >= cutoff);
            return fixes;
        },
        fixes: () => fixes,
        get size() {
            return fixes.length;
        },
    };
}

/**
 * Every signal for one new fix.
 *
 * @param {object} params
 * @param {object} params.fix the fix that just arrived
 * @param {object[]} params.window trailing fixes, oldest first, including this one
 * @param {[number, number]} [params.home]
 * @param {number} params.lastArrivalMs
 * @param {number} params.nowMs
 * @returns {object}
 */
export function computeSignals({ fix, window, home, lastArrivalMs, nowMs }) {
    const previous = window.at(-2);

    return {
        time: fix.time,
        latlong: fix.latlong,
        speed: previous ? speedBetween(previous, fix) : null,
        moved: previous ? distance(previous.latlong, fix.latlong) : null,
        interval: previous ? fix.time - previous.time : null,
        thrash: thrashRatio(window),
        // How far she actually got over the window, as opposed to how much
        // path she accumulated. The two diverge wildly when the tracker is
        // sitting still: one measured hour on the charger accumulated 390m of
        // path while its centre never moved more than 6.5m. The detectors
        // gate on this so that noise cannot raise an alarm (**C41**).
        displacementM: centreDisplacement(window),
        staleness: staleness(lastArrivalMs, nowMs),
        fromHome: home ? distance(home, fix.latlong) : null,
        accuracy: fix.accuracy,
        sensor: fix.sensor_used,
    };
}
