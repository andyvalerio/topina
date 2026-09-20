/**
 * Tracker commands.
 *
 * These act on a physical device attached to a live animal: live tracking
 * drains the battery in hours, and the buzzer and LED are audible and visible
 * to the cat. Nothing here should fire without a deliberate decision.
 */
import { authHeaders } from './auth.js';

const BASE = 'https://graph.tractive.com/4/tracker';

/**
 * @param {string} token
 * @param {string} trackerId
 * @param {string} command
 * @param {boolean} active
 * @returns {Promise<object>}
 */
async function send(token, trackerId, command, active) {
    const url = `${BASE}/${encodeURIComponent(trackerId)}/command/${command}/${active ? 'on' : 'off'}`;
    const res = await fetch(url, { headers: authHeaders(token) });
    return res.json();
}

/** Live tracking: ~2-5s fixes, but the device stops after `custom_lt_timeout`. */
export const setLiveTracking = (token, trackerId, active) =>
    send(token, trackerId, 'live_tracking', active);

export const setBuzzer = (token, trackerId, active) =>
    send(token, trackerId, 'buzzer_control', active);

export const setLed = (token, trackerId, active) => send(token, trackerId, 'led_control', active);
