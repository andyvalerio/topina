/**
 * Knowing whether she is out, and keeping live tracking on while she is.
 *
 * The signal is not geometry. Indoors, live mode produces **no fresh fixes** —
 * measured: 55 seconds of confirmed-active live tracking indoors yielded only
 * the same stale position re-sent (**C17**). Outdoors it produces one every
 * four seconds. So *a fresh GPS fix during a sample means she is outside*, and
 * no radius or boundary is involved.
 *
 * Distance from home is used for exactly one thing: when fixes stop, deciding
 * whether she walked back indoors or lost signal somewhere out there. Near
 * home means home. Far from home means trouble, and that is the moment worth
 * hearing about (**C31** is why it cannot be used for anything else).
 *
 * Pure: state and events in, next state and actions out. No timers, no
 * network, no clock of its own.
 */

/** @typedef {'charging'|'off-hours'|'waiting'|'sampling'|'out'|'signal-lost'} Phase */

export const DEFAULTS = {
    /** Hours she could plausibly be outside. She is never out at night. */
    windowStartHour: 7,
    windowEndHour: 17,

    /** How often to sample when she might be out but we have no fixes. */
    sampleIntervalS: 180,

    /** How long to hold live on while waiting for a fix to prove she is out. */
    sampleDurationS: 30,

    /** Quiet this long while out means she went in, or lost signal. */
    quietS: 180,

    /** Only for telling "came home" from "lost signal out there". */
    homeRadiusM: 20,

    /** Consecutive fixes inside a danger zone before it counts as being there. */
    dangerDwellFixes: 3,

    /** How much to tighten thresholds inside a danger zone. */
    dangerFactor: 0.7,

    dangerZoneEnabled: true,

    /** Report the battery each time it drops past a multiple of this. */
    batteryStepPercent: 10,

    /** How many days of raw fixes to keep. Incidents are kept forever. */
    retentionDays: 30,

    /** Hour of the day to send proof that the monitor is alive. */
    heartbeatHour: 7,

    heartbeatEnabled: true,
};

/**
 * One sentence per setting, so the dashboard can explain itself. Nobody
 * remembers what `quietS` meant a month later.
 */
export const DESCRIBED = {
    windowStartHour: 'Hour she might first go out. Nothing is sampled before this — she is never out at night.',
    windowEndHour: 'Hour after which she is assumed in for the night. Sampling stops.',
    sampleIntervalS: 'How often to check whether she has gone out, while she might be out and no fixes are arriving.',
    sampleDurationS: 'How long to hold live tracking on while waiting for a fix to prove she is outside. Nine seconds is usually enough.',
    quietS: 'How long without a fresh fix, while she is out, before deciding she went in or lost signal.',
    homeRadiusM: 'Used only when fixes stop: within this she came home, beyond it she lost signal outdoors.',
    dangerDwellFixes: 'How many consecutive fixes inside a danger zone before it counts. The rival zone starts 30m from the house, so stray fixes cross its edge constantly.',
    dangerFactor: 'How much to tighten alarm thresholds while she is in a danger zone. 0.7 means a sprint alarms at 70% of the usual speed.',
    dangerZoneEnabled: 'Whether danger zones read from Tractive affect anything at all.',
    batteryStepPercent: 'Report the battery each time it falls past a multiple of this. 10 means a notification at 90%, 80% and so on.',
    retentionDays: 'How many days of raw fixes to keep before deleting them. Incidents are never deleted - they are scarce and they are the part worth keeping.',
    heartbeatHour: 'Hour of the day to send one notification proving the monitor is alive. If it never arrives, something is wrong.',
    heartbeatEnabled: 'Whether to send that daily proof-of-life notification at all.',
};

/**
 * Decide what to do next.
 *
 * @param {{phase: Phase, since: number, lastFreshFixMs: number|null,
 *          lastDistanceM: number|null}} state
 * @param {{nowMs: number, hour: number, charging: boolean,
 *          freshFix: boolean, distanceM: number|null, holdUntilMs: number,
 *          holdLive: boolean|null}} input
 * @param {typeof DEFAULTS} [config]
 * @returns {{phase: Phase, since: number, lastFreshFixMs: number|null,
 *           lastDistanceM: number|null, live: boolean, notify: string|null}}
 */
export function step(state, input, config = DEFAULTS) {
    const { nowMs, hour, charging, freshFix, distanceM, holdUntilMs, holdLive } = input;

    const lastFreshFixMs = freshFix ? nowMs : state.lastFreshFixMs;
    const lastDistanceM = freshFix && distanceM !== null ? distanceM : state.lastDistanceM;
    const base = { lastFreshFixMs, lastDistanceM };

    const enter = (phase, notify = null) => ({
        ...base,
        phase,
        since: phase === state.phase ? state.since : nowMs,
        live: phase === 'sampling' || phase === 'out' || phase === 'signal-lost',
        notify,
    });

    // A manual hold outranks everything, including the charging check: if
    // someone asked for live, they get live (**L5**).
    if (nowMs < holdUntilMs && holdLive !== null) {
        return { ...enter(holdLive ? 'out' : 'waiting'), live: holdLive };
    }

    // Charging means the tracker is off her and indoors. Nothing to do, and
    // no command worth sending.
    if (charging) return enter('charging');

    if (hour < config.windowStartHour || hour >= config.windowEndHour) {
        return enter('off-hours');
    }

    const quietFor = lastFreshFixMs === null ? Infinity : nowMs - lastFreshFixMs;

    // Already out and still hearing from her: stay live, say nothing.
    if ((state.phase === 'out' || state.phase === 'signal-lost') && freshFix) {
        return enter('out', state.phase === 'signal-lost' ? 'signal-back' : null);
    }

    if (state.phase === 'out' && quietFor >= config.quietS * 1000) {
        // Fixes stopped. Where she was last tells us which kind of stop.
        const nearHome = lastDistanceM !== null && lastDistanceM <= config.homeRadiusM;
        return nearHome ? enter('waiting', 'home') : enter('signal-lost', 'signal-lost');
    }

    if (state.phase === 'signal-lost') {
        // Keep live on and keep looking; she is out there somewhere.
        return enter('signal-lost');
    }

    // Out, and quiet but not for long enough to mean anything. A pause under
    // a bush is not going indoors, and sampling here would toggle live off at
    // the worst possible moment.
    if (state.phase === 'out') return enter('out');

    // A fresh fix while sampling is the whole test: she is outside.
    if (state.phase === 'sampling') {
        if (freshFix) return enter('out', 'out');
        if (nowMs - state.since >= config.sampleDurationS * 1000) return enter('waiting');
        return enter('sampling');
    }

    // Waiting between samples.
    if (nowMs - state.since >= config.sampleIntervalS * 1000 || state.phase !== 'waiting') {
        return enter('sampling');
    }

    return enter('waiting');
}

/**
 * Starting state.
 *
 * `since: 0` rather than now, so the first sample runs immediately instead of
 * waiting out a full interval — on startup we have no idea where she is, and
 * that is exactly when we most want to look.
 */
export const initial = () => ({
    phase: /** @type {Phase} */ ('waiting'),
    since: 0,
    lastFreshFixMs: null,
    lastDistanceM: null,
});
