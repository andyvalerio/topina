/**
 * What a notification says, and how loudly.
 *
 * Away from home the notification and the Tractive app are the entire
 * experience — the dashboard is LAN-only (**N12**). So the body has to carry
 * the facts on its own: what happened, how far from home, and where. Tapping
 * opens Tractive on her live map, because they have already built a map and
 * we should not build another.
 *
 * Tiers matter as much as content. "Topina is out" and "sprint in the enemy's
 * garden" arriving with the same weight would train you to ignore both, and an
 * ignored alert costs the same attention as a useful one while buying nothing.
 */

/** Tapping any notification lands on her live map. Deeper paths error (**C28**). */
export const TRACTIVE_APP = 'https://applink.tractive.com/';

/**
 * @typedef {'info'|'warn'|'alarm'} Tier
 */

/** What each kind of news is worth interrupting you for. */
export const TIERS = {
    out: 'info',
    home: 'info',
    still: 'info',
    'signal-back': 'info',
    battery: 'warn',
    'signal-lost': 'alarm',
    'zone-entered': 'info',
};

/** Findings are alarms by definition; elevated ones are warnings. */
const tierForLevel = (level) => (level === 'alarm' ? 'alarm' : 'warn');

/**
 * Plain English for each kind of news. Machine-generated titles like
 * "no gps" read as a log line; these read as someone telling you something.
 */
const FINDING_TITLES = {
    sprint: 'bolted',
    thrash: 'is thrashing around',
    silence: 'has gone quiet',
    'no-gps': 'is under cover',
    'far-from-home': 'is a long way out',
};

/**
 * Compose the message for an outing transition.
 *
 * @param {string} kind
 * @param {{petName: string, distanceM: number|null, latlong: [number, number]|null,
 *          battery: number|null, zone: string|null}} context
 * @returns {{title: string, body: string, tier: Tier, url: string, latlong: [number, number]|null}}
 */
export function forOuting(kind, context) {
    const { petName, distanceM, latlong } = context;

    const titles = {
        out: `${petName} is out`,
        home: `${petName} is back`,
        still: `${petName} is not out after all`,
        'signal-lost': `Can't see ${petName}`,
        'signal-back': `${petName} is back in view`,
        'zone-entered': `${petName} is in ${context.zone ?? 'the danger zone'}`,
    };

    const bodies = {
        out: 'live tracking on',
        home: 'live tracking off',
        // Says what was decided and why, because this one retracts something
        // already announced. Without the reason it reads as a malfunction.
        still: 'nothing has moved for half an hour near home — live tracking off',
        // The one case where the last known position is the whole point.
        'signal-lost': 'no fixes arriving — last seen',
        'signal-back': 'fixes resumed',
        'zone-entered': 'watching more closely',
    };

    return {
        title: titles[kind] ?? `${petName}: ${kind}`,
        body: withPlace(bodies[kind] ?? kind, distanceM),
        tier: TIERS[kind] ?? 'info',
        url: TRACTIVE_APP,
        latlong,
    };
}

/**
 * Compose the message for detector findings.
 *
 * @param {{code: string, level: string, detail: string}[]} findings
 * @param {object} context
 */
export function forFindings(findings, context) {
    const { petName, distanceM, latlong, zone } = context;
    const worst = findings.find((f) => f.level === 'alarm') ?? findings[0];
    const where = zone ? ` in ${zone}` : '';

    const said = FINDING_TITLES[worst.code] ?? worst.code.replace(/-/g, ' ');

    return {
        title: `${petName} ${said}${where}`,
        body: withPlace(findings.map((f) => f.detail).join(' · '), distanceM),
        tier: tierForLevel(worst.level),
        url: TRACTIVE_APP,
        latlong,
    };
}

/**
 * Battery warning, at each step down.
 * @param {number} percent
 * @param {string} petName
 */
export const forBattery = (percent, petName) => ({
    title: `${petName}'s tracker is at ${percent}%`,
    body: percent <= 20 ? 'charge it soon, tracking will stop' : 'still tracking',
    tier: /** @type {Tier} */ (percent <= 20 ? 'alarm' : 'warn'),
    url: TRACTIVE_APP,
    latlong: null,
});

/**
 * Append distance from home.
 *
 * Coordinates used to be here too and were dead weight — nobody reads six
 * decimal places on a lock screen, and tapping through shows her on a map
 * anyway. Distance is the part that means something at a glance.
 */
function withPlace(body, distanceM) {
    const parts = [body];
    if (distanceM !== null && distanceM !== undefined) parts.push(`${distanceM.toFixed(0)}m from home`);
    return parts.join(' · ');
}

/**
 * Which battery thresholds have been crossed going down.
 *
 * Every 10% by default, so a slow drain reports steadily rather than all at
 * once at the end.
 *
 * @param {number|null} previous
 * @param {number} current
 * @param {number} stepPercent
 * @returns {number|null} the threshold crossed, or null
 */
export function batteryStepCrossed(previous, current, stepPercent) {
    if (previous === null || current >= previous) return null;
    const step = (v) => Math.floor(v / stepPercent) * stepPercent;
    return step(current) < step(previous) ? step(current) : null;
}

/**
 * Which quiet period a notification belongs to, if any.
 *
 * Two buckets, because they need different patience. Comings and goings are
 * routine and get an hour. Losing sight of her is not routine — but it flaps
 * by construction: with `quietS` at 180 seconds, fixes arriving every ~200
 * seconds from under a car produce `signal-lost`, a fix, `signal-back`, and
 * round again, about **36 notifications an hour**. The first loss must always
 * get through; the flapping after it must not.
 *
 * Anything not listed here — an alarm, the rival's garden — is never rationed.
 */
const BUCKETS = {
    out: 'lifecycle',
    home: 'lifecycle',
    still: 'lifecycle',
    'signal-lost': 'signal',
    'signal-back': 'signal',
};

/** Nothing is pending. */
export const noQuiet = () => ({ lifecycle: 0, signal: 0 });

/**
 * Whether a notification should reach the phone.
 *
 * Being let out is news. Being outside is not, and she is in and out all day,
 * so the state machine changing its mind is not an event worth a buzz. On
 * 2026-09-21 the life-cycle notifications fired **86 times in three hours** —
 * 43 announcements and 43 retractions, alternating every three minutes — which
 * is how a monitor teaches someone to ignore it, and then misses the one that
 * mattered.
 *
 * So the first announcement opens a quiet period over its bucket. Any of them
 * opens it, not just `out`: a retraction firing the moment the period lapsed
 * would move the noise rather than remove it.
 *
 * Pure: the caller owns the quiet state and stores it, the same way the outing
 * state and the hold are stored, so a restart does not reopen the floodgates.
 *
 * @param {string} kind
 * @param {{lifecycle: number, signal: number}} quiet epoch milliseconds
 * @param {object} config
 * @param {number} nowMs
 * @returns {{send: boolean, quiet: {lifecycle: number, signal: number}}}
 */
export function announce(kind, quiet, config, nowMs) {
    const bucket = BUCKETS[kind];
    if (!bucket) return { send: true, quiet };

    const enabled = {
        out: config.notifyOutEnabled,
        home: config.notifyHomeEnabled,
        still: config.notifyStillEnabled,
        'signal-lost': true,
        'signal-back': true,
    }[kind];

    // Switched off, or inside the quiet period. Either way the event still
    // happened and is still recorded — this decides the buzz, nothing else.
    if (!enabled || nowMs < quiet[bucket]) return { send: false, quiet };

    const forS = bucket === 'signal' ? config.notifySignalQuietS : config.notifyQuietS;
    return { send: true, quiet: { ...quiet, [bucket]: nowMs + forS * 1000 } };
}
