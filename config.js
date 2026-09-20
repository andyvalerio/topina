/**
 * Environment-backed configuration.
 *
 * Nothing identifying — account, pet, tracker, or the pet's name — belongs in
 * the source of a public repo. It all arrives through the environment, and the
 * only thing checked in is the shape of it in `.env.example`.
 */
const {
    TRACTIVE_EMAIL,
    TRACTIVE_PASSWORD,
    TRACTIVE_PET_ID,
    TRACTIVE_TRACKER_ID,
    TRACTIVE_USER_ID,
    PET_NAME,
} = process.env;

export const credentials = {
    email: TRACTIVE_EMAIL,
    password: TRACTIVE_PASSWORD,
};

export const petId = TRACTIVE_PET_ID;
export const trackerId = TRACTIVE_TRACKER_ID;
export const userId = TRACTIVE_USER_ID;

/** Falls back to something neutral so logs read sensibly on a fresh checkout. */
export const petName = PET_NAME || 'the cat';

/**
 * Why the given env vars can't be used, or false when they're all present.
 * @param {...string} names
 * @returns {string|false}
 */
export function missing(...names) {
    const absent = names.filter((name) => !process.env[name]);
    return absent.length
        ? `missing ${absent.join(', ')} in env (copy .env.example to .env and fill it in)`
        : false;
}
