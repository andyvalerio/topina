/**
 * Step 2: one-shot position.
 *
 * Proves we can get a real fix for the tracker, and shows what the REST report
 * carries that a live channel fix does not — notably `speed`, and accuracy
 * under the name `pos_uncertainty` (**C12**).
 */
import { session } from './auth.js';
import * as rest from './rest.js';
import { distance } from './geo.js';
import { credentials, missing, petId, petName, trackerId } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

const { token } = await session(credentials);
const report = await rest.getPosition(token, trackerId);

console.log(`--- raw position report for ${petName} ---`);
console.dir(report, { depth: null });

const [latitude, longitude] = report.latlong ?? [];
const ageSeconds = Math.round(Date.now() / 1000 - report.time);

console.log('\n--- derived ---');
console.log('position:      ', latitude, longitude);
console.log('report age:    ', `${ageSeconds}s (${(ageSeconds / 60).toFixed(1)} min)`);
console.log('sensor used:   ', report.sensor_used);
console.log('accuracy (m):  ', report.pos_uncertainty);
console.log('speed:         ', report.speed, `(${typeof report.speed})`);
console.log('altitude:      ', report.altitude);

if (petId) {
    const pet = await rest.getPet(token, petId);
    const home = pet?.home_location;
    if (Array.isArray(home) && latitude != null) {
        console.log('distance home: ', `${Math.round(distance(home, [latitude, longitude]))}m`);
    }
}
