/**
 * Knowing whether she is out, and keeping live tracking on while she is.
 *
 * ## The premise this was built on, and why it was wrong
 *
 * The original discriminator was that indoors, live mode produces **no fresh
 * fixes** — measured once, over 55 seconds (**C17**). A fresh fix during a
 * sample therefore meant she was outside, and no radius or boundary was
 * involved.
 *
 * An hour of the tracker sitting on its charger on 2026-09-21 falsified that
 * outright: **747 fresh GPS fixes, four seconds apart, indoors**, which the
 * state machine read as an outing and held open for the whole hour. C17 was a
 * single short observation, and it does not generalise (**C41**).
 *
 * Worse, nothing position-shaped replaces it. Against a week of her own fixes,
 * a resting cat in the garden and a tracker on its dock are the same reading:
 * her median centre displacement over a minute is 2.7m against the charger's
 * 1.2m, and the charger's fix scatter is *tighter* than hers. Displacement can
 * refute an outing but cannot establish one (**C42**, and see displacement.js
 * for the numbers).
 *
 * ## What holds the line instead
 *
 * Two things, neither of which is a positive test for being outside:
 *
 * 1. **A sticky docked latch.** `charging_state` is not the question — "is it
 *    on the dock" is. The charger stops charging at 100% and reports
 *    `NOT_CHARGING`, so the old check went blind exactly when the tracker had
 *    been docked longest. The latch instead closes on the first sight of
 *    charging and opens only on proof of movement.
 * 2. **Retraction on stillness.** An outing used to end only on *silence*, so
 *    a stationary tracker emitting fixes stayed "out" forever. Half an hour of
 *    going nowhere, near home, now ends it.
 *
 * Distance from home is still used for exactly one thing: when fixes stop,
 * deciding whether she walked back indoors or lost signal somewhere out
 * there. Near home means home. Far from home means trouble (**C31**).
 *
 * Pure: state and events in, next state and actions out. No timers, no
 * network, no clock of its own.
 */


/** @typedef {'docked'|'off-hours'|'waiting'|'sampling'|'out'|'signal-lost'} Phase */

import {
    DEPARTURE_M,
    REACTION_DEPARTURE_M,
    REACTION_WINDOW_S,
    STILL_M,
    STILLNESS_WINDOW_S,
} from './displacement.js';

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

    /**
     * Movement over half an hour that opens the docked latch. Measured: a
     * charger-bound tracker never exceeded 3.5m over that span.
     */
    departureM: DEPARTURE_M,

    /**
     * Movement over one minute that opens the latch without waiting for the
     * long window. Three times the measured 60-second stationary ceiling.
     */
    reactionDepartureM: REACTION_DEPARTURE_M,

    /** Movement over half an hour below which an outing is not an outing. */
    stillM: STILL_M,

    /**
     * The span `stillM` and `departureM` are judged over. The window length
     * *is* the duration — below `stillM` across this window already means
     * this long going nowhere, so there is no separate timer to keep in step
     * with it.
     */
    stillnessWindowS: STILLNESS_WINDOW_S,

    /** The span `reactionDepartureM` is judged over. */
    reactionWindowS: REACTION_WINDOW_S,

    stillnessRetractEnabled: true,

    /**
     * How long the phone stays quiet about her comings and goings after one
     * of them has been announced.
     *
     * Measured need: on 2026-09-21 the life-cycle notifications fired 86 times
     * in three hours. Being let out is news; being outside is not, and she is
     * in and out all day.
     */
    notifyQuietS: 3600,

    /**
     * The same, for losing and regaining sight of her. Longer, because this
     * pair flaps hardest: intermittent fixes produce a loss and a return every
     * few minutes indefinitely. The first loss is never held back.
     */
    notifySignalQuietS: 1800,

    notifyOutEnabled: true,
    notifyHomeEnabled: false,
    notifyStillEnabled: true,

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
    departureM: 'How far the tracker\u2019s centre must move over half an hour to count as having left the charger. Measured: on the charger it never moved more than 3.5m over that span.',
    reactionDepartureM: 'The same proof, over one minute instead of thirty, so a real outing is not missed for half an hour. Higher because a minute is a noisier basis: the charger\u2019s one-minute ceiling was 6.5m.',
    stillM: 'Movement over the long window below which she is treated as not out at all. Only applies within the home radius, so she is never written off while she is away from the house.',
    stillnessWindowS: 'The span the long window covers, in seconds. It is both the basis of \u201cnot out after all\u201d and the patience before saying so - at 1800 it takes half an hour of going nowhere. Shorter reacts faster and risks writing off a cat having a long sit.',
    reactionWindowS: 'The span the short window covers, in seconds. How quickly the tracker leaving its charger can be noticed. Shorter is faster but noisier, so it pairs with the higher threshold above.',
    stillnessRetractEnabled: 'Whether half an hour of going nowhere near home ends an outing. Turning this off restores the old behaviour, where only silence could end one - which is how a tracker on its charger stayed \u201cout\u201d for an entire morning.',
    notifyQuietS: 'How long the phone stays quiet about comings and goings after one has been announced. Alarms are never affected. At 3600 you hear about an outing at most once an hour, however many times the state machine changes its mind.',
    notifySignalQuietS: 'How long the phone stays quiet after \u201ccan\u2019t see her\u201d or \u201cshe is back in view\u201d. The first loss always gets through; this only stops the two flipping back and forth, which they do every few minutes when fixes are intermittent.',
    notifyOutEnabled: 'Whether \u201cshe is out\u201d reaches the phone at all. Subject to the quiet period above.',
    notifyHomeEnabled: 'Whether \u201cshe is back\u201d reaches the phone. Off by default: she is in and out all day, so it carries the same noise as announcing every departure.',
    notifyStillEnabled: 'Whether \u201cnot out after all\u201d reaches the phone. It is a retraction of something already announced, and it is wrong about 43% of the time against her own history, so it is worth being able to silence without switching the retraction itself off.',
    dangerDwellFixes: 'How many consecutive fixes inside a danger zone before it counts. The rival zone starts 30m from the house, so stray fixes cross its edge constantly.',
    dangerFactor: 'How much to tighten alarm thresholds while she is in a danger zone. 0.7 means a sprint alarms at 70% of the usual speed.',
    dangerZoneEnabled: 'Whether danger zones read from Tractive affect anything at all.',
    batteryStepPercent: 'Report the battery each time it falls past a multiple of this. 10 means a notification at 90%, 80% and so on.',
    retentionDays: 'How many days of raw fixes to keep before deleting them. Incidents are never deleted - they are scarce and they are the part worth keeping.',
    heartbeatHour: 'Hour of the day to send one notification proving the monitor is alive. If it never arrives, something is wrong.',
    heartbeatEnabled: 'Whether to send that daily proof-of-life notification at all.',
};

/**
 * Whether the tracker is on its dock, given where it was a moment ago.
 *
 * Sticky on purpose. `charging_state` goes to `NOT_CHARGING` the moment the
 * battery reaches 100%, so a tracker that has sat on the dock all night reads
 * exactly like one clipped to a cat. Latching on the first sight of charging
 * and holding until something moves closes that hole: the only way off the
 * dock is to physically leave it.
 *
 * `batteryFull` latches too, but **only when nothing is known about the dock
 * yet**. It is there for the case where the service boots onto an already-full
 * docked tracker and so never witnesses the charging transition. That is true
 * of a cold start, and equally true on the first tick after an upgrade from a
 * version that had no latch at all — a stored state with no `docked` key knows
 * nothing about the dock, and without this the upgrade would land with the
 * latch open on a tracker sitting at 100% and reporting NOT_CHARGING, which is
 * precisely the blind spot being closed.
 *
 * Both paths are guarded on her not already being out, so a full battery can
 * never steal an outing in progress — she often goes out on a full charge, and
 * that must stay an outing.
 *
 * @param {{phase: Phase, docked: boolean, since: number}} state
 * @param {{charging: boolean, batteryFull: boolean, movedM: number|null,
 *          movedRecentlyM: number|null}} input
 * @param {typeof DEFAULTS} config
 * @returns {boolean}
 */
export function dockedNext(state, input, config = DEFAULTS) {
    const { charging, batteryFull, movedM, movedRecentlyM } = input;

    // Either window can prove movement. The short one is what keeps a real
    // outing from going unnoticed for half an hour; the long one catches a
    // slow drift the short one is too noisy to call.
    const moved =
        (movedRecentlyM !== null && movedRecentlyM >= config.reactionDepartureM) ||
        (movedM !== null && movedM >= config.departureM);

    if (charging) return true;
    if (state.docked) return !moved;

    // Absent, rather than false: a stored state written before the latch
    // existed has no opinion about the dock, as opposed to one that has
    // decided the tracker is off it.
    const dockUnknown = state.docked === undefined;
    const coldStart = state.phase === 'waiting' && state.since === 0;
    const notAlreadyOut = state.phase !== 'out' && state.phase !== 'signal-lost';

    return (coldStart || dockUnknown) && notAlreadyOut && batteryFull && !moved;
}

/**
 * Decide what to do next.
 *
 * @param {{phase: Phase, since: number, lastFreshFixMs: number|null,
 *          lastDistanceM: number|null, docked: boolean}} state
 * @param {{nowMs: number, hour: number, charging: boolean, batteryFull: boolean,
 *          freshFix: boolean, distanceM: number|null, movedM: number|null,
 *          movedRecentlyM: number|null, stillnessSettled: boolean,
 *          holdUntilMs: number, holdLive: boolean|null}} input
 * @param {typeof DEFAULTS} [config]
 * @returns {{phase: Phase, since: number, lastFreshFixMs: number|null,
 *           lastDistanceM: number|null, docked: boolean, live: boolean,
 *           notify: string|null}}
 */
export function step(state, input, config = DEFAULTS) {
    const { nowMs, hour, freshFix, distanceM, movedM, stillnessSettled, holdUntilMs, holdLive } =
        input;

    const lastFreshFixMs = freshFix ? nowMs : state.lastFreshFixMs;
    const lastDistanceM = freshFix && distanceM !== null ? distanceM : state.lastDistanceM;
    const docked = dockedNext(state, input, config);
    const base = { lastFreshFixMs, lastDistanceM, docked };

    const enter = (phase, notify = null) => ({
        ...base,
        phase,
        since: phase === state.phase ? state.since : nowMs,
        live: phase === 'sampling' || phase === 'out' || phase === 'signal-lost',
        notify,
    });

    // A manual hold outranks everything, including the dock: if someone asked
    // for live, they get live (**L5**).
    if (nowMs < holdUntilMs && holdLive !== null) {
        return { ...enter(holdLive ? 'out' : 'waiting'), live: holdLive };
    }

    // On the dock means off her and indoors. Nothing to do, and no command
    // worth sending — and, unlike the old charging check, this stays true
    // once the battery fills up and charging stops.
    if (docked) return enter('docked');

    if (hour < config.windowStartHour || hour >= config.windowEndHour) {
        return enter('off-hours');
    }

    const quietFor = lastFreshFixMs === null ? Infinity : nowMs - lastFreshFixMs;

    // Half an hour of going nowhere, near home, is not an outing — whatever
    // the fixes say. This is the check whose absence let a tracker on its
    // charger stay "out" for a whole morning: the only previous way out of
    // this phase was silence, and a stationary tracker is not silent.
    //
    // Deliberately limited to within the home radius. Out in the field,
    // stillness is at least as likely to mean something has gone wrong as to
    // mean she is not there, and writing off an outing is the one error this
    // system must not make.
    // The outing must have *run* for the window before stillness can end it.
    // Without this the retraction fires seconds after `out` is entered — the
    // rolling window is already full and already below threshold, so the
    // outing never gets to exist. On 2026-09-21 that produced a three-hour
    // loop: out, retracted five seconds later, re-declared three minutes
    // later, 43 times over. "Half an hour of going nowhere" has to mean half
    // an hour of *this outing* going nowhere.
    const outingRunFor = nowMs - state.since;

    if (
        state.phase === 'out' &&
        config.stillnessRetractEnabled &&
        outingRunFor >= config.stillnessWindowS * 1000 &&
        stillnessSettled &&
        movedM !== null &&
        movedM < config.stillM &&
        lastDistanceM !== null &&
        lastDistanceM <= config.homeRadiusM
    ) {
        return enter('waiting', 'still');
    }

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

    // A fresh fix while sampling is the best evidence available that she is
    // outside — but it is no longer taken as proof on its own. It is reached
    // only once the docked latch is open, which is what the 747 indoor fixes
    // of 2026-09-21 would have failed to do.
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
    docked: false,
});
