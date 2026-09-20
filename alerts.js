/**
 * Deciding when a notification is worth sending.
 *
 * The detectors run on every fix, roughly every four seconds. Notifying on
 * each one would mean a dozen buzzes for a single incident, which trains you
 * to ignore the phone — and an ignored alert is worse than no alert, because
 * it costs the same attention and buys nothing.
 *
 * So: notify when a finding *appears*, then stay quiet about it for a cooldown
 * even if it keeps firing. Pure, with the clock passed in.
 */

/** How long a given finding stays quiet after being announced. */
export const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * @param {{cooldownMs?: number}} [options]
 */
export function createAlerter({ cooldownMs = COOLDOWN_MS } = {}) {
    /** @type {Map<string, number>} */
    const lastSent = new Map();

    return {
        /**
         * Which findings deserve a notification right now.
         *
         * @param {{code: string, level: string, detail: string}[]} findings
         * @param {number} nowMs
         * @returns {{code: string, level: string, detail: string}[]}
         */
        due(findings, nowMs) {
            const fresh = findings.filter((finding) => {
                const previous = lastSent.get(finding.code);
                return previous === undefined || nowMs - previous >= cooldownMs;
            });

            for (const finding of fresh) lastSent.set(finding.code, nowMs);

            // A finding that has stopped is forgotten, so if it comes back
            // after the incident it announces itself again rather than being
            // swallowed by a cooldown from the previous one.
            const active = new Set(findings.map((f) => f.code));
            for (const code of [...lastSent.keys()]) {
                if (!active.has(code) && nowMs - lastSent.get(code) >= cooldownMs) {
                    lastSent.delete(code);
                }
            }

            return fresh;
        },
    };
}
