/**
 * Sending a push notification through FCM.
 *
 * No SDK: the Firebase Admin library is large and all we need is one signed
 * JWT exchanged for an access token, then one POST. Node's crypto signs
 * RS256, which keeps the project at zero runtime dependencies.
 *
 * The service-account key is a credential with send rights on the Firebase
 * project — gitignored, and in production a Kubernetes Secret (**D3**).
 */
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** Access tokens last an hour; renew a little early rather than racing it. */
const RENEW_MARGIN_S = 300;

const base64url = (input) =>
    Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Sign a JWT asserting we are the service account.
 * @param {{client_email: string, private_key: string}} key
 * @returns {string}
 */
function signAssertion(key) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
        JSON.stringify({
            iss: key.client_email,
            scope: SCOPE,
            aud: TOKEN_URI,
            iat: issuedAt,
            exp: issuedAt + 3600,
        })
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    return `${header}.${claims}.${base64url(signer.sign(key.private_key))}`;
}

/**
 * A notifier bound to one service account and one device.
 *
 * @param {{keyPath: string, deviceToken: string}} config
 */
export function createNotifier({ keyPath, deviceToken }) {
    let key = null;
    let accessToken = null;
    let expiresAt = 0;

    async function authorise() {
        key ??= JSON.parse(await readFile(keyPath, 'utf8'));
        if (accessToken && Date.now() / 1000 < expiresAt - RENEW_MARGIN_S) return accessToken;

        const res = await fetch(TOKEN_URI, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: signAssertion(key),
            }),
        });

        const data = await res.json();
        if (!data.access_token) throw new Error(`FCM auth failed: ${JSON.stringify(data)}`);

        accessToken = data.access_token;
        expiresAt = Date.now() / 1000 + data.expires_in;
        return accessToken;
    }

    return {
        /**
         * @param {{title: string, body: string, urgent?: boolean}} message
         * @returns {Promise<{ok: boolean, detail?: string}>}
         */
        async send({ title, body, urgent = true, url = null }) {
            const token = await authorise();

            const res = await fetch(
                `https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: {
                            token: deviceToken,
                            notification: { title, body },
                            // Carried as data so the app can open the map on
                            // tap; notification payloads cannot do that alone.
                            data: url ? { url } : undefined,
                            android: {
                                // "high" is what wakes a dozing handset
                                // promptly; normal priority may be batched,
                                // which for this is the same as not sending.
                                priority: urgent ? 'high' : 'normal',
                                notification: { channel_id: 'topina_alerts' },
                            },
                        },
                    }),
                }
            );

            if (res.ok) return { ok: true };
            return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
        },
    };
}
