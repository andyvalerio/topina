/**
 * Query-string parsing for the dashboard's time windows.
 *
 * Its own module so it can be tested without starting a server, and pure with
 * the clock injected, the same way the signal maths is.
 */

/**
 * The largest magnitude a `Date` can represent, in milliseconds. Beyond this
 * every Date method throws `RangeError: Invalid time value`.
 */
export const MAX_TIME_MS = 8.64e15;

/**
 * Whether a value can safely be handed to `new Date()` and formatted.
 *
 * Finite is not sufficient: `Number('9e99')` is finite but far outside the
 * range a Date can hold, and throws exactly like `NaN` does.
 *
 * @param {number} value
 * @returns {boolean}
 */
export function usableTime(value) {
    return Number.isFinite(value) && Math.abs(value) <= MAX_TIME_MS;
}

/**
 * A time window from a query string, defaulting when absent or unparseable.
 *
 * `Number('abc')` is NaN, and `new Date(NaN).toISOString()` throws — which,
 * in an async request handler with nothing catching it, took the whole
 * service down. A monitor that a mistyped URL can kill is not a monitor
 * (**D5**), so anything unusable falls back to the default instead of
 * throwing.
 *
 * @param {URLSearchParams} params
 * @param {number} defaultSpanMs how far back to look when `from` is absent
 * @param {number} [nowMs] epoch milliseconds
 * @returns {{from: number, to: number}} epoch milliseconds
 */
export function timeRange(params, defaultSpanMs, nowMs = Date.now()) {
    const parse = (name, fallback) => {
        const raw = params.get(name)?.trim();
        // Absent, empty, or whitespace-only all mean "not specified". Trimming
        // matters: `Number(' ')` is 0, not NaN, so a stray space would quietly
        // export everything back to 1970 instead of falling back.
        if (!raw) return fallback;
        const value = Number(raw);
        return usableTime(value) ? value : fallback;
    };
    return { from: parse('from', nowMs - defaultSpanMs), to: parse('to', nowMs) };
}
