/**
 * When to do a real login.
 *
 * The auth endpoint locks the account out after a handful of logins (C20), so
 * the rule is: log in once, keep the token, log in again only when it is
 * genuinely running out. Getting this wrong doesn't degrade gracefully — it
 * takes the whole API away for several minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsable, needsRenewal, REFRESH_MARGIN_S } from '../../auth.js';

const NOW = 1_800_000_000;
const expiring = (inSeconds) => ({ expiresAt: NOW + inSeconds });

test('a fresh token is left alone', () => {
    // Tokens last ~60 days; this is the overwhelmingly common case.
    assert.equal(needsRenewal(expiring(86400 * 60), NOW), false);
});

test('no token at all means log in', () => {
    assert.equal(needsRenewal(null, NOW), true);
});

test('a token inside the refresh margin is renewed early', () => {
    assert.equal(needsRenewal(expiring(REFRESH_MARGIN_S - 1), NOW), true);
});

test('a token just outside the refresh margin is not', () => {
    assert.equal(needsRenewal(expiring(REFRESH_MARGIN_S + 1), NOW), false);
});

test('an expired token means log in', () => {
    assert.equal(needsRenewal(expiring(-1), NOW), true);
});

test('a token inside the margin is still usable', () => {
    // This is what keeps us working when renewal is rate-limited: the token
    // is due for renewal but the API still accepts it.
    const token = expiring(REFRESH_MARGIN_S - 1);

    assert.equal(needsRenewal(token, NOW), true);
    assert.equal(isUsable(token, NOW), true);
});

test('an expired token is not usable', () => {
    assert.equal(isUsable(expiring(-1), NOW), false);
});

test('a missing token is not usable', () => {
    assert.equal(isUsable(null, NOW), false);
});
