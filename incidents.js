/**
 * Incidents: the thing that happened, rather than the fixes it happened
 * across.
 *
 * A finding is a property of one reading and vanishes with it. That is fine
 * for deciding whether to buzz a phone and useless for everything after: you
 * cannot review a finding, cannot say "that one was real", and cannot tune
 * thresholds against four hundred thousand fixes.
 *
 * An incident opens when something confirms, stretches while anything stays
 * active, and closes after a quiet spell — keeping what it peaked at, so a
 * later question like "what was she actually doing?" has an answer.
 */

/** How long everything must stay calm before an incident is considered over. */
export const CLOSE_AFTER_MS = 2 * 60 * 1000;

/**
 * @typedef {{startedAt: number, endedAt: number|null, codes: string[],
 *            peak: {speed: number|null, thrash: number|null, fromHome: number|null},
 *            zone: string|null, lastActiveAt: number}} Incident
 */

/**
 * @param {{closeAfterMs?: number}} [options]
 */
export function createIncidents({ closeAfterMs = CLOSE_AFTER_MS } = {}) {
    /** @type {Incident|null} */
    let open = null;

    const peak = (a, b) => (a === null || a === undefined ? b : b === null || b === undefined ? a : Math.max(a, b));

    return {
        /**
         * Fold one reading in.
         *
         * @param {{findings: {code: string}[], signals: object, zone: string|null, nowMs: number}} input
         * @returns {{opened: Incident|null, closed: Incident|null, open: Incident|null}}
         */
        update({ findings, signals, zone, nowMs }) {
            let opened = null;
            let closed = null;

            if (findings.length) {
                if (!open) {
                    open = {
                        startedAt: nowMs,
                        endedAt: null,
                        codes: [],
                        peak: { speed: null, thrash: null, fromHome: null },
                        zone,
                        lastActiveAt: nowMs,
                    };
                    opened = open;
                }

                for (const f of findings) if (!open.codes.includes(f.code)) open.codes.push(f.code);
                open.peak.speed = peak(open.peak.speed, signals?.speed);
                open.peak.thrash = peak(open.peak.thrash, signals?.thrash);
                open.peak.fromHome = peak(open.peak.fromHome, signals?.fromHome);
                // A zone entered partway through still describes the incident.
                if (zone) open.zone = zone;
                open.lastActiveAt = nowMs;
            } else if (open && nowMs - open.lastActiveAt >= closeAfterMs) {
                open.endedAt = open.lastActiveAt;
                closed = open;
                open = null;
            }

            return { opened, closed, open };
        },

        /** Whatever is still open, for a shutdown that should not lose it. */
        current: () => open,

        /** @param {Incident|null} incident */
        restore(incident) {
            open = incident;
        },
    };
}
