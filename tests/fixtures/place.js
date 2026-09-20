/**
 * Coordinates for tests.
 *
 * Deliberately fictional. Real ones would put the house — and the
 * neighbour's — into a public repo, which is exactly what **G3** forbids.
 * Nothing is lost by inventing them: every assertion in these tests is
 * relative (this point is inside that box, these two points are ~1m apart),
 * so they prove geometry, not geography.
 *
 * Latitude stays near the real deployment's so that metres-per-degree of
 * longitude — which scales with cos(latitude) — behaves the same as in
 * production. Round numbers, so nobody mistakes them for a real reading.
 *
 * Real geometry can still be exercised without committing it:
 *
 *     TEST_HOME_LAT=... TEST_HOME_LON=... npm test
 */

const fromEnv = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
};

/** @type {[number, number]} */
export const HOME = [fromEnv('TEST_HOME_LAT', 57.0), fromEnv('TEST_HOME_LON', 12.0)];

/**
 * Metres per degree of latitude, on the same sphere `geo.js` measures with
 * (`EARTH_RADIUS_M` = 6371000). Deriving it from a different constant makes a
 * fixture's "one metre" read as 0.999m to the code under test, which is
 * enough to flip an assertion that sits on a threshold.
 */
const METRES_PER_DEGREE = (6371000 * Math.PI) / 180;

/**
 * A point a given number of metres from another.
 *
 * Lets a fixture say what it means — "the far corner is 100m north-east" —
 * instead of pasting opaque decimals that only happen to have that property.
 *
 * @param {[number, number]} origin
 * @param {number} metresNorth
 * @param {number} metresEast
 * @returns {[number, number]}
 */
export function offset([lat, lon], metresNorth, metresEast) {
    const perDegreeEast = METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    return [lat + metresNorth / METRES_PER_DEGREE, lon + metresEast / perDegreeEast];
}
