/**
 * Step 2: one-shot position.
 *
 * Proves we can get a real fix for the tracker, and answers the questions the
 * signal work depends on: how stale is a report, which fields actually arrive
 * populated, and is the reported speed usable.
 */
import tractive from 'tractive';
import { credentials, missing, petId, petName, trackerId } from './config.js';

const blocked = missing('TRACTIVE_EMAIL', 'TRACTIVE_PASSWORD', 'TRACTIVE_TRACKER_ID');
if (blocked) {
    console.error(blocked);
    process.exit(1);
}

if (!(await tractive.connect(credentials.email, credentials.password))) {
    console.error('Auth failed.');
    process.exit(1);
}

const report = await tractive.getTrackerLocation(trackerId);

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

// Distance from home tells us whether home_location is usable as a reference
// point, and gives the first real sanity check on the coordinates.
if (petId) {
    const pet = await tractive.getPet(petId);
    const home = pet?.home_location;
    if (Array.isArray(home) && latitude != null) {
        console.log('distance home: ', `${Math.round(haversine(home, [latitude, longitude]))}m`);
    }
}

/**
 * Great-circle distance in metres between two [lat, long] pairs.
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
function haversine([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
