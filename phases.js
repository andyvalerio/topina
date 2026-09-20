/**
 * The guided walk protocol.
 *
 * Everything recorded so far is a tracker at rest, which tells us nothing
 * about what movement looks like. This walks a person through a fixed
 * sequence of paces so the recording carries labelled examples of each.
 *
 * Still at both ends on purpose: it shows whether speed settles back cleanly
 * after movement stops, or overshoots. Overshoot would mean false alarms
 * firing just as a cat stops running — exactly when an alert should clear.
 */

/** @typedef {{label: string, seconds: number}} Phase */

/** @type {Phase[]} */
export const WALK_PROTOCOL = [
    { label: 'STAND STILL — hold the tracker, do not move', seconds: 30 },
    { label: 'WALK SLOWLY', seconds: 30 },
    { label: 'WALK NORMALLY', seconds: 30 },
    { label: 'FAST BURSTS — jog or quick strides', seconds: 20 },
    { label: 'STAND STILL again — hold until it ends', seconds: 30 },
];

/** @param {Phase[]} phases */
export const totalSeconds = (phases) => phases.reduce((sum, p) => sum + p.seconds, 0);

/**
 * Which phase is active at a given point, and how far in.
 *
 * @param {number} elapsed seconds since the protocol started
 * @param {Phase[]} phases
 * @returns {{index: number, phase: Phase, into: number}|null} null once finished
 */
export function phaseAt(elapsed, phases) {
    let start = 0;

    for (const [index, phase] of phases.entries()) {
        if (elapsed < start + phase.seconds) {
            return { index, phase, into: elapsed - start };
        }
        start += phase.seconds;
    }

    return null;
}

/**
 * A short tag for the recording, so analysis can group fixes by pace.
 * @param {number} elapsed
 * @param {Phase[]} phases
 * @returns {string}
 */
export function phaseTag(elapsed, phases) {
    if (elapsed < 0) return 'warmup';
    const active = phaseAt(elapsed, phases);
    return active ? `${active.index + 1}-${active.phase.label.split(/[ —]/)[0].toLowerCase()}` : 'done';
}

/**
 * Read a numeric option from argv, falling back when it is absent or junk.
 *
 * Written as a function because doing it inline got it wrong: `Number(x || d)`
 * applies the fallback to the *string* and yields NaN, and a NaN delay makes
 * setTimeout fire immediately — so a whole timed protocol collapses into one
 * instant with no error anywhere.
 *
 * @param {string[]} args
 * @param {string} flag
 * @param {number} fallback
 * @returns {number}
 */
export function numericOption(args, flag, fallback) {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;

    const value = Number(args[index + 1]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
