/**
 * Proving the monitor is alive.
 *
 * The worst failure in this whole system is silent: the service dies, no
 * alerts arrive, and that is indistinguishable from a quiet afternoon. You
 * would not find out until the day it mattered.
 *
 * So once a day it says so. One notification, at the start of her window,
 * reporting that it is watching and what the battery is. If it does not
 * arrive, something is wrong — which is a check that costs one message a day
 * and needs nothing outside the system to run it.
 */

/**
 * Should the daily heartbeat be sent now?
 *
 * Deliberately not "every 24 hours": a fixed hour means its absence is
 * noticeable at a time you are awake, rather than drifting into the night.
 *
 * @param {{hour: number, day: string}} now
 * @param {string|null} lastSentDay
 * @param {number} atHour
 * @returns {boolean}
 */
export function due({ hour, day }, lastSentDay, atHour) {
    if (hour < atHour) return false;
    return lastSentDay !== day;
}

/** @param {Date} date */
export const dayKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * @param {{petName: string, battery: number|null, phase: string, incidentsToday: number}} context
 */
export const message = ({ petName, battery, phase, incidentsToday }) => ({
    title: `Watching ${petName}`,
    body: [
        phase === 'charging' ? 'tracker on charge' : `tracker ${phase}`,
        battery === null ? null : `battery ${battery}%`,
        incidentsToday ? `${incidentsToday} incident${incidentsToday === 1 ? '' : 's'} yesterday` : null,
    ]
        .filter(Boolean)
        .join(' · '),
    tier: /** @type {'info'} */ ('info'),
    url: 'https://applink.tractive.com/',
    latlong: null,
});
