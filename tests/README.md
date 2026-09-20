# Tests

## Unit (`tests/unit/`)

Pure logic, no network, milliseconds to run: distance maths, channel-event
merging, and the token-renewal decision. These cover the things that fail
*silently* — a dropped position looks like a calm cat, and an over-eager login
locks the account out of the API entirely.

```bash
npm run test:unit
```

## End-to-end (`tests/e2e/`)

These run against the **real Tractive API**. There are no mocks, deliberately:
the API is undocumented and we don't yet understand its behaviour, so a mock
would only assert that our assumptions match our assumptions. The value of these
tests is catching the day Tractive changes something under us.

They need credentials in `.env` and a network connection. Without either they
**skip** rather than fail, so the suite stays green on a machine that isn't set
up.

```bash
npm run test:e2e
```

One file per plan step, so a failure points straight at the rung of the ladder
that broke:

| File | Step | Covers |
|---|---|---|
| `auth.test.js` | 1 | Auth works, the pet and tracker are reachable |
| `position.test.js` | 2 | A position report arrives with the fields detectors need |
| `channel.test.js` | 3 | The push channel opens, holds, and snapshots the tracker |

Note these authenticate through the same cached `session()` the app uses, so a
test run costs no logins once a token is cached.

### What is deliberately not tested

[`commands.js`](../commands.js) has no automated coverage. Live tracking,
the buzzer and the LED act on a physical device attached to a live animal —
live tracking drains the battery in hours, and the buzzer is audible to the
cat. A test suite must never fire those as a side effect of `npm test`.
They're exercised deliberately through `npm run live`.

## Coordinates (`tests/fixtures/place.js`)

Every coordinate in these tests is invented. Real ones would put the house —
and a neighbour's — into a public repo, which **G3** forbids, and nothing is
gained by them: every assertion here is relative (this point is inside that
box, these two are a metre apart), so the tests prove geometry, not geography.
Verified by running the whole suite against an injected real location and
against Sydney; both pass.

Fixtures say what they mean — `offset(HOME, -50, 30)` rather than fifteen
opaque decimals that happen to sit 30m east — so the property under test is
readable instead of pasted.

Real geometry can still be exercised without committing it:

```bash
TEST_HOME_LAT=... TEST_HOME_LON=... npm test
```

One trap worth knowing. `place.js` derives metres-per-degree from the same
sphere `geo.js` measures with (`EARTH_RADIUS_M`). An earlier constant differed
by 0.07%, which was enough to flip three assertions that sat exactly on a
threshold — `fromHome > 8` against a fixture 8m from home, and a thrash ratio
that returns null below a metre of net displacement against a fixture at
exactly one metre. They had been passing on a rounding artefact rather than on
behaviour. Fixtures now sit clear of their thresholds.

### Conventions

- Authenticate through `connect()` in [`../helpers.js`](helpers.js) — it caches,
  so tests don't re-auth needlessly.
- Guard every test with `{ skip: missingCredentials }`.
- Assert on **shape and presence**, not on specific values. Coordinates, battery
  levels and timestamps all change; `_id` existing does not.
