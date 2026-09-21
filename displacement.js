/**
 * Has the tracker actually gone anywhere?
 *
 * This is a different question from "is it moving", and the distinction is
 * what this module exists for. A tracker sitting on its charger indoors
 * produces a stream of fixes that *look* like movement — 390m of accumulated
 * path in one measured hour — while going nowhere at all. Speed, path length
 * and the thrash ratio all read that noise as motion. Net displacement does
 * not (**C41**).
 *
 * ## Why the median, not the endpoints
 *
 * The obvious net displacement — first fix to last fix — is destroyed by a
 * single bad fix. In the hour of 2026-09-21 07:00 the tracker never left the
 * charger, yet one fix jumped 49.5m, and simple endpoint displacement over a
 * sliding window peaked at **52m**. Comparing the *median* position of the
 * window's first half against the median of its second half discards that
 * outlier entirely: over the same hour, at every span from 60s to 30 minutes,
 * it never exceeded **6.5m**.
 *
 *   span    endpoint p99/max      median-centre p99/max
 *   60s      7.0 / 46.9            5.3 / 6.5
 *   300s     8.1 / 51.7            6.2 / 6.5
 *   1800s      —                   3.5 / 3.5
 *
 * ## What this can and cannot answer
 *
 * It answers **"the tracker has moved"** with confidence: anything past
 * `DEPARTURE_M` is beyond what an hour of stationary noise ever produced.
 *
 * It does **not** answer "she is outside". Measured against a week of her own
 * fixes (6,403 of them), she is stationary most of the time she is out: over
 * 60-second windows her median centre displacement is 2.7m against the
 * charger's 1.2m, and only 1.7% of her genuinely-outdoor windows clear 15m.
 * A resting cat in the garden and a tracker on its dock are, from position
 * alone, the same reading. Displacement can therefore *refute* an outing but
 * never *establish* one (**C42**) — which is why `outing.js` uses it to hold
 * the docked latch shut and to retract a stale outing, and never to open one.
 */
import { distance } from './geo.js';

/**
 * Movement that proves the tracker left its dock.
 *
 * The measured stationary ceiling is 6.5m at every span. 15m is over twice
 * that, and still well inside what she covers walking out of the house —
 * her own dense-window p99 is 17.6m over a single minute.
 */
export const DEPARTURE_M = 15;

/**
 * Below this, the tracker is sitting in its own noise.
 *
 * Deliberately lower than `DEPARTURE_M`, so leaving and returning are not the
 * same threshold. Without that gap a reading hovering at the boundary would
 * flip the outing on and off every window.
 */
export const STILL_M = 7;

/**
 * The window the outing state machine judges stillness over.
 *
 * The window length *is* the duration — displacement below `STILL_M` across a
 * 30-minute window already means half an hour of going nowhere, so no
 * separate timer is needed. Over the charging hour the 30-minute figure never
 * exceeded 3.5m, against a median of 9.2m for her real week.
 *
 * The default only. Both windows are settings (`stillnessWindowS`,
 * `reactionWindowS` in outing.js) and can be changed from the dashboard while
 * the service runs, which is what `resize` below is for.
 */
export const STILLNESS_WINDOW_S = 1800;

/**
 * The window the docked latch opens on.
 *
 * Short, because it wants to react quickly: an outing noticed half an hour
 * late is worse than a false one.
 *
 * The sprint gate uses a *different* window — the one `signals.js` already
 * keeps for the thrash ratio (`WINDOW_S`, also 60s). They are deliberately
 * separate: this one is a tuning knob for how fast the latch opens, that one
 * is the basis of a derived signal and changing it would silently move the
 * thrash ratio with it.
 */
export const REACTION_WINDOW_S = 60;

/**
 * Movement over the reaction window that unlatches the dock.
 *
 * Higher than `DEPARTURE_M` because one minute is a much noisier basis than
 * thirty. 20m is three times the measured 60-second stationary ceiling of
 * 6.5m, and her own 60-second p99 is 17.6m with a maximum of 27.3m — so it
 * fires on genuine movement and on nothing else.
 */
export const REACTION_DEPARTURE_M = 20;

/**
 * Median of a list of numbers. Even-length lists average the middle pair.
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The median position of a group of fixes.
 *
 * Latitude and longitude are taken independently. That is not a true
 * geometric median, but over the tens of metres this deals with the
 * difference is far below GPS uncertainty, and it costs no iteration.
 *
 * @param {{latlong: [number, number]}[]} fixes
 * @returns {[number, number]}
 */
export function medianCentre(fixes) {
    return [median(fixes.map((f) => f.latlong[0])), median(fixes.map((f) => f.latlong[1]))];
}

/**
 * The fewest fixes an answer can rest on.
 *
 * Not a setting, and not a preference. The median of each half is what makes
 * this robust to a single wild fix, and a half of fewer than three has no
 * median worth the name — two points average, one point *is* the outlier.
 * Six is the floor the method itself imposes.
 *
 * At the four-second live cadence this is why the sprint gate cannot fire for
 * roughly the first twenty seconds of a live session.
 */
export const MIN_FIXES = 6;

/** How full a window must be before its answer is acted on. */
export const SETTLED_FRACTION = 0.6;

/**
 * How far the tracker's centre moved across a set of fixes.
 *
 * Splits them in half by order and compares the two median centres. Fewer
 * than `MIN_FIXES` gives each half too little to reject an outlier with,
 * which is the entire point of the median, so it reports nothing rather than
 * a number that has not earned confidence.
 *
 * @param {{latlong: [number, number], time: number}[]} fixes oldest first
 * @returns {number|null} metres, or null when there is not enough to say
 */
export function centreDisplacement(fixes) {
    if (fixes.length < MIN_FIXES) return null;

    const half = fixes.length >> 1;
    return distance(medianCentre(fixes.slice(0, half)), medianCentre(fixes.slice(half)));
}

/**
 * A rolling window of fixes reporting how far the centre has moved.
 *
 * Trimmed by the tracker's own clock, like `createWindow` in signals.js and
 * for the same reason (**C14**): the span being measured is between fixes, so
 * it must be measured in the clock the fixes carry.
 *
 * `span` reports how much history the answer actually rests on. A caller
 * deciding something as consequential as "she is not out after all" needs to
 * know whether the window is full or has two minutes in it after a restart.
 *
 * @param {number} [seconds]
 */
export function createDisplacement(seconds = REACTION_WINDOW_S) {
    /** @type {{latlong: [number, number], time: number}[]} */
    let fixes = [];

    return {
        /**
         * Change the span this window covers, for a setting edited while the
         * service is running.
         *
         * Shortening it drops the history that no longer fits immediately,
         * rather than leaving a stale answer in place until the next fix
         * arrives — on a tracker that has gone quiet, that could be minutes.
         *
         * @param {number} next seconds
         */
        resize(next) {
            if (!(next > 0) || next === seconds) return;
            seconds = next;
            if (fixes.length) {
                const cutoff = fixes.at(-1).time - seconds;
                fixes = fixes.filter((f) => f.time >= cutoff);
            }
        },

        /** The span this window currently covers, in seconds. */
        get seconds() {
            return seconds;
        },

        /**
         * @param {{latlong: [number, number], time: number}} fix
         * @returns {{displacementM: number|null, span: number, count: number}}
         */
        add(fix) {
            fixes.push(fix);
            const cutoff = fix.time - seconds;
            fixes = fixes.filter((f) => f.time >= cutoff);
            return this.value();
        },

        value() {
            const span = fixes.length ? fixes.at(-1).time - fixes[0].time : 0;
            return { displacementM: centreDisplacement(fixes), span, count: fixes.length };
        },

        /**
         * Whether the window holds enough history for its answer to mean
         * anything.
         *
         * Six fixes is the method's own floor (`MIN_FIXES`); the 0.6 is a
         * judgement that a window a little short of full is still worth
         * acting on, and that one two minutes into a half-hour span is not.
         */
        settled() {
            return (
                fixes.length >= MIN_FIXES &&
                fixes.at(-1).time - fixes[0].time >= seconds * SETTLED_FRACTION
            );
        },

        reset() {
            fixes = [];
        },
    };
}
