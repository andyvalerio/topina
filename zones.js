/**
 * Danger zones, read from Tractive rather than configured here.
 *
 * The rival's patch already exists in the account as a geofence the user drew
 * and named, with `fence_type: DANGER`. Reading it means nothing to configure
 * and it stays editable in the official app, where it belongs.
 *
 * Being inside it is **not** an alarm. Measured over a week she is in there
 * 7.1% of the time across eleven apparent visits — alarming on entry would
 * fire constantly for ordinary wandering. It is a risk modifier: inside, the
 * same behaviour means more, so thresholds tighten and findings escalate.
 *
 * And membership needs **dwell**. Nine of those eleven visits were one or two
 * fixes lasting under three minutes, because the zone's nearest corner is 30m
 * from the house and ordinary GPS scatter crosses the boundary (**C27**).
 */
import { distance } from './geo.js';

/**
 * Is a point inside a fence?
 *
 * Tractive gives rectangles as two opposite corners, circles as a centre and
 * a radius, polygons as a ring of points.
 *
 * @param {[number, number]} point
 * @param {{shape: string, coords: number[][], radius: number|null}} fence
 * @returns {boolean}
 */
export function inside(point, fence) {
    const coords = fence?.coords;
    if (!Array.isArray(coords) || coords.length === 0) return false;

    if (fence.shape === 'CIRCLE') {
        return distance(coords[0], point) <= (fence.radius ?? 0);
    }

    if (fence.shape === 'RECTANGLE') {
        const [a, b] = coords;
        if (!b) return false;
        const [south, north] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
        const [west, east] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
        return point[0] >= south && point[0] <= north && point[1] >= west && point[1] <= east;
    }

    return insidePolygon(point, coords);
}

/**
 * Ray casting. Good enough at these distances, where a degree of longitude is
 * effectively a straight line.
 *
 * @param {[number, number]} point
 * @param {number[][]} ring
 * @returns {boolean}
 */
function insidePolygon([lat, lon], ring) {
    let is = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [latI, lonI] = ring[i];
        const [latJ, lonJ] = ring[j];
        const crosses = latI > lat !== latJ > lat;
        if (crosses && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) is = !is;
    }
    return is;
}

/**
 * Tracks whether she is *really* in a zone, rather than momentarily scattered
 * across its edge.
 *
 * Entering needs `dwell` consecutive fixes inside. Leaving is immediate: a
 * fix outside means outside, because lingering in a raised-risk state after
 * she has left would mean tightened thresholds firing on ordinary behaviour
 * somewhere harmless.
 *
 * @param {number} dwell
 */
export function createZoneWatcher(dwell = 3) {
    let streak = 0;
    let engaged = false;

    return {
        /**
         * @param {[number, number]|null} point
         * @param {object[]} fences
         * @returns {{inside: boolean, entered: boolean, left: boolean, fence: object|null}}
         */
        update(point, fences) {
            const fence = point ? fences.find((f) => inside(point, f)) ?? null : null;

            if (!fence) {
                const left = engaged;
                streak = 0;
                engaged = false;
                return { inside: false, entered: false, left, fence: null };
            }

            streak += 1;
            const entered = !engaged && streak >= dwell;
            if (entered) engaged = true;
            return { inside: engaged, entered, left: false, fence: engaged ? fence : null };
        },
    };
}

/**
 * Thresholds tightened for being somewhere dangerous.
 *
 * The same sprint means more in the rival's garden than in her own.
 *
 * @param {object} thresholds
 * @param {number} factor
 * @returns {object}
 */
export function tighten(thresholds, factor) {
    return {
        ...thresholds,
        sprint: thresholds.sprint * factor,
        thrash: thresholds.thrash * factor,
        silenceS: Math.round(thresholds.silenceS * factor),
    };
}

/**
 * Raise every finding one tier. Elevated becomes alarm; an alarm is already
 * the top.
 * @param {{level: string}[]} findings
 */
export const escalate = (findings) =>
    findings.map((f) => (f.level === 'elevated' ? { ...f, level: 'alarm' } : f));
