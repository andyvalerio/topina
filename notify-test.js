/**
 * Send a test push, so the phone can be verified without waiting for a cat to
 * get into trouble.
 *
 *   npm run notify:test
 */
import { createNotifier } from './notify.js';
import { fcm, petName } from './config.js';

if (!fcm.deviceToken) {
    console.error('No FCM_TOKEN in env. Open the app, copy the device token, and put it in .env.');
    process.exit(1);
}

const notifier = createNotifier({ keyPath: fcm.keyPath, deviceToken: fcm.deviceToken });
const result = await notifier.send({
    title: `${petName}: test alert`,
    body: 'If this buzzed, the whole chain works.',
});

console.log(result.ok ? 'sent — check the phone' : `failed: ${result.detail}`);
process.exit(result.ok ? 0 : 1);
