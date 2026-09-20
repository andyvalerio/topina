/**
 * Running tracker state, assembled from channel deltas.
 *
 * The channel sends a complete `tracker_status` on connect and partial ones
 * afterwards, carrying only the fields that changed (**C16**). Replacing state
 * on each event would therefore drop position and hardware the moment any
 * control toggles. So events are merged.
 *
 * Positions also repeat with an identical `time` (**C18**); a repeat is not a
 * new fix and must not reach the signal calculations, where it would divide by
 * a zero interval.
 */

/**
 * Merge a channel event into a snapshot, returning a new snapshot.
 *
 * Nested objects (position, hardware, the controls) merge field by field;
 * arrays and scalars replace outright, so a `latlong` pair is never blended
 * with a previous one.
 *
 * @param {object} snapshot
 * @param {object} event
 * @returns {object}
 */
export function merge(snapshot, event) {
    const merged = { ...snapshot };

    for (const [key, value] of Object.entries(event)) {
        const existing = merged[key];
        merged[key] =
            isPlainObject(value) && isPlainObject(existing) ? merge(existing, value) : value;
    }

    return merged;
}

const isPlainObject = (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accumulates channel events into a snapshot and reports genuinely new fixes.
 * @returns {{apply: (event: object) => object|null, snapshot: () => object}}
 */
export function createTracker() {
    let snapshot = {};
    let lastFixTime = null;

    return {
        /**
         * Fold an event in.
         * @param {object} event
         * @returns {object|null} the position, when this event carried a new one
         */
        apply(event) {
            snapshot = merge(snapshot, event);

            const position = event.position;
            if (!position?.latlong || position.time === lastFixTime) return null;

            lastFixTime = position.time;
            return position;
        },

        snapshot: () => snapshot,
    };
}
