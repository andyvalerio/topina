/**
 * The REST calls we actually use.
 *
 * These replace the `tractive` wrapper, which cost more than it saved: its
 * published npm build is broken, it keeps its token on `globalThis`, it has no
 * token refresh, and `getPet` dereferences `details` without a guard so a
 * rate-limited response crashes inside the library rather than returning an
 * error we can handle. Each call below is a few lines against a documented-by-
 * observation endpoint, and they share one auth path with the channel.
 *
 * Rate limiting is per resource and arrives as HTTP 200 with an error body,
 * so callers must check rather than trust the status code (**C7**).
 */
import { authHeaders } from './auth.js';

const BASE = 'https://graph.tractive.com/4';

/**
 * @param {string} token
 * @param {string} path
 * @returns {Promise<any>}
 */
async function get(token, path) {
    const res = await fetch(`${BASE}/${path}`, { headers: authHeaders(token) });
    return res.json();
}

/** Rate limiting looks like data, not like an error. */
export const isRateLimited = (response) => response?.code === 4006;

export const getPets = (token, userId) => get(token, `user/${userId}/trackable_objects`);

export const getTrackers = (token, userId) => get(token, `user/${userId}/trackers`);

export const getPet = (token, petId) => get(token, `trackable_object/${petId}`);

export const getTracker = (token, trackerId) => get(token, `tracker/${trackerId}`);

export const getHardware = (token, trackerId) => get(token, `device_hw_report/${trackerId}`);

/** Geofence stubs for a tracker; the detail call has the geometry. */
export const getGeofences = (token, trackerId) => get(token, `tracker/${trackerId}/geofences`);

export const getGeofence = (token, fenceId) => get(token, `geofence/${fenceId}`);

/**
 * Latest position report. Unlike a channel fix this carries `speed` and names
 * accuracy `pos_uncertainty` (**C12**), and it can be many minutes stale.
 * @param {string} token
 * @param {string} trackerId
 * @returns {Promise<any>}
 */
export const getPosition = (token, trackerId) => get(token, `device_pos_report/${trackerId}`);

/**
 * Reverse-geocode a position. Free context when an alert fires.
 * @param {string} token
 * @param {[number, number]} latlong
 * @returns {Promise<any>}
 */
export const getAddress = (token, [latitude, longitude]) =>
    get(token, `platform/geo/address/location?latitude=${latitude}&longitude=${longitude}`);
