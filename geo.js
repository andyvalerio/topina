/**
 * Geographic helpers.
 *
 * Distances here are small — metres to hundreds of metres — so a spherical
 * earth is far more precision than the 9m GPS uncertainty deserves.
 */

const EARTH_RADIUS_M = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres between two [latitude, longitude] pairs.
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {number}
 */
export function distance([lat1, lon1], [lat2, lon2]) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Mean position of a set of fixes. Good enough as the "true" location of a
 * stationary tracker, which is what the noise floor is measured against.
 * @param {[number, number][]} points
 * @returns {[number, number]}
 */
export function centroid(points) {
    const sum = points.reduce(([lat, lon], [y, x]) => [lat + y, lon + x], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
}
