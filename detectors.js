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
     * Provisional. A cat sprint is 3-8 m/s in the literature; the fastest we
     * have actually recorded is a jogging human at 1.58. Set below a cat
     * sprint and well above any measured walking, then corrected by what she
     * actually does.
     */
    sprint: 2.5,

    /**
     * Provisional. Walking in a line measured ~1.3; jogging around a confined
     * garden measured 5.7-8.8. A scuffle should look like the latter.
     */
    thrash: 4,

    /** Provisional. At a 4s cadence, this is ~20 missed fixes. */
    silenceS: 90,

    /** Provisional. No territory baseline exists yet — see Q-territory. */
    farFromHomeM: 150,

    /** Consecutive fixes a condition must hold before it escalates. */
    sustain: 2,
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
    if (signals.staleness >= thresholds.silenceS) {
        found.push({
            code: 'silence',
            level: 'alarm',
            detail: `no data for ${signals.staleness.toFixed(0)}s`,
        });
    }

    if (signals.speed !== null && signals.speed >= thresholds.sprint) {
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
    if (movingNow && signals.thrash !== null && signals.thrash >= thresholds.thrash) {
        found.push({
            code: 'thrash',
            level: 'alarm',
            detail: `ratio ${signals.thrash.toFixed(1)} — moving hard, going nowhere`,
        });
    }

    // Not GPS means under a car, a shed, or dense cover. Worth knowing on its
    // own, and it degrades the trust in every other signal.
    if (signals.sensor && signals.sensor !== 'GPS') {
        found.push({
            code: 'no-gps',
            level: 'elevated',
            detail: `position from ${signals.sensor}`,
        });
    }

    if (signals.fromHome !== null && signals.fromHome >= thresholds.farFromHomeM) {
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
        assess(signals) {
            const current = findings(signals, thresholds);
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
