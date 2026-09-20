/**
 * Detectors: turning signals into a judgement.
 *
 * Thresholds are anchored to measurements where we have them and are honest
 * guesses where we do not. Everything measured came from a human walking with
 * the tracker; nothing here has yet seen a cat in trouble, so the numbers are
 * expected to move. They live in one object so changing them is a one-line
 * edit, and the whole corpus can be replayed against a change.
 *
 * Pure: signals in, findings out. The only state is the sustain counter, which
 * exists so a single noisy fix cannot raise an alarm.
 */

/**
 * @typedef {'calm'|'elevated'|'alarm'} Level
 * @typedef {{code: string, level: Level, detail: string}} Finding
 */

export const DEFAULTS = {
    /** Measured: still never exceeded 0.23 m/s, walking slowly ran 0.69. */
    moving: 0.4,

    /**
     * From a week of her own dense history (5,866 fixes ≤10s apart): her
     * median is 0.19 m/s, p99 is 1.49, p99.9 is 3.89, and her observed
     * maximum is 9.38 — a genuine bolt.
     *
     * Swept against that history, by distinct events per week:
     *   2.0 → 19    2.5 → 16    3.0 → 9    3.5 → 6    4.0 → 5    5.0 → 2
     *
     * 2.5 was the original guess and would have fired sixteen times a week,
     * which is an alarm you learn to ignore. 3.0 costs a little
     * over one a day and errs toward noticing, which is the trade this
     * project wants: being slow to notice trouble is worse than a false
     * alarm. Still a guess about *danger* — none of those nine events is
     * known to have been one.
     */
    sprint: 3.0,

    /**
     * Provisional. Walking in a line measured ~1.3; jogging around a confined
     * garden measured 5.7-8.8. A scuffle should look like the latter.
     */
    thrash: 4,

    /** Provisional. At a 4s cadence, this is ~20 missed fixes. */
    silenceS: 90,

    /**
     * Her territory is far smaller than assumed. Over a week: p50 14m, p95
     * 47m, p99 62m, and an all-time maximum of 142m. **The original 150m
     * threshold could never fire at all** — it was dead code.
     *
     * There is a sharp edge to her range: 60m catches 89 fixes, 70m catches
     * 5. Her world ends around 65m. 80m sits clear of that edge while
     * remaining reachable, and fires about five times a week.
     */
    farFromHomeM: 80,

    /** Consecutive fixes a condition must hold before it escalates. */
    sustain: 2,

    // Each detector can be switched off from the dashboard. A detector that
    // is crying wolf should be silenced deliberately rather than by quietly
    // pushing its threshold out of reach, where the reason is lost.
    sprintEnabled: true,
    thrashEnabled: true,
    silenceEnabled: true,
    noGpsEnabled: true,
    farFromHomeEnabled: true,
};

/** One sentence per setting, so the dashboard can explain itself. */
export const DESCRIBED = {
    moving: 'Speed above which she counts as genuinely moving rather than sitting in GPS noise. Measured: still never exceeded 0.23 m/s, walking slowly 0.69.',
    sprint: 'Speed that raises a sprint alarm. From a week of her own movement: median 0.19 m/s, p99 1.49, fastest ever 9.38. At 3.0 this fires roughly nine times a week.',
    thrash: 'Ratio of distance travelled to ground actually covered. Walking in a line scores about 1.3; jogging around a confined space scored 5.7-8.8. High means moving hard and going nowhere.',
    silenceS: 'Seconds with no data at all before raising the alarm. At the four-second live cadence this is about twenty missed fixes.',
    farFromHomeM: 'Distance from home that counts as unusual for her. Her p99 is 62m and she has never exceeded 142m.',
    sustain: 'How many consecutive readings a condition must hold before it escalates. Stops one noisy fix raising an alarm.',
    sprintEnabled: 'Whether the sprint detector runs at all.',
    thrashEnabled: 'Whether the thrash detector runs at all.',
    silenceEnabled: 'Whether the silence detector runs at all.',
    noGpsEnabled: 'Whether to flag positions that came from something other than GPS — under a car, a shed, dense cover.',
    farFromHomeEnabled: 'Whether to flag her being unusually far from home.',
};

const RANK = { calm: 0, elevated: 1, alarm: 2 };

/**
 * Assess one reading. Stateless — no sustain logic, no memory.
 *
 * @param {object} signals from computeSignals
 * @param {typeof DEFAULTS} [thresholds]
 * @returns {Finding[]}
 */
export function findings(signals, thresholds = DEFAULTS) {
    const found = [];

    // Silence first: it is the only finding that can fire when nothing else
    // can, because everything else needs a fix to have arrived.
    if (thresholds.silenceEnabled && signals.staleness >= thresholds.silenceS) {
        found.push({
            code: 'silence',
            level: 'alarm',
            detail: `no data for ${signals.staleness.toFixed(0)}s`,
        });
    }

    if (thresholds.sprintEnabled && signals.speed !== null && signals.speed >= thresholds.sprint) {
        found.push({
            code: 'sprint',
            level: 'alarm',
            detail: `${signals.speed.toFixed(2)} m/s`,
        });
    }

    // Thrash is windowed, so the ratio stays high for the length of the
    // window after movement stops — replaying the walk showed it alarming
    // through a full minute of standing perfectly still. Requiring current
    // movement too means a scuffle alarms while it is happening and clears
    // when it ends, which is the behaviour that makes an alert trustworthy.
    const movingNow = signals.speed !== null && signals.speed >= thresholds.moving;
    if (thresholds.thrashEnabled && movingNow && signals.thrash !== null && signals.thrash >= thresholds.thrash) {
        found.push({
            code: 'thrash',
            level: 'alarm',
            detail: `ratio ${signals.thrash.toFixed(1)} — moving hard, going nowhere`,
        });
    }

    // Not GPS means under a car, a shed, or dense cover. Worth knowing on its
    // own, and it degrades the trust in every other signal.
    if (thresholds.noGpsEnabled && signals.sensor && signals.sensor !== 'GPS') {
        found.push({
            code: 'no-gps',
            level: 'elevated',
            detail: `position from ${signals.sensor}`,
        });
    }

    if (thresholds.farFromHomeEnabled && signals.fromHome !== null && signals.fromHome >= thresholds.farFromHomeM) {
        found.push({
            code: 'far-from-home',
            level: 'elevated',
            detail: `${signals.fromHome.toFixed(0)}m from home`,
        });
    }

    return found;
}

/** @param {Finding[]} list */
export const worst = (list) =>
    list.reduce((level, f) => (RANK[f.level] > RANK[level] ? f.level : level), 'calm');

/**
 * A detector with memory, so one noisy fix cannot raise an alarm.
 *
 * A condition must hold for `sustain` consecutive readings before it counts.
 * Clearing is immediate: being slow to notice trouble is worse than being
 * quick to relax, and a condition that stops holding has stopped.
 *
 * @param {typeof DEFAULTS} [thresholds]
 */
export function createDetector(thresholds = DEFAULTS) {
    /** @type {Map<string, number>} */
    const streak = new Map();

    return {
        /**
         * @param {object} signals
         * @returns {{level: Level, findings: Finding[], pending: Finding[]}}
         */
        assess(signals, override = null) {
            const current = findings(signals, override ?? thresholds);
            const seen = new Set(current.map((f) => f.code));

            for (const code of streak.keys()) {
                if (!seen.has(code)) streak.delete(code);
            }

            const confirmed = [];
            const pending = [];

            for (const finding of current) {
                const count = (streak.get(finding.code) ?? 0) + 1;
                streak.set(finding.code, count);
                (count >= thresholds.sustain ? confirmed : pending).push(finding);
            }

            return { level: worst(confirmed), findings: confirmed, pending };
        },
    };
}
