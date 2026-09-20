# Tests

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

### Conventions

- Authenticate through `connect()` in [`../helpers.js`](helpers.js) — it caches,
  so tests don't re-auth needlessly.
- Guard every test with `{ skip: missingCredentials }`.
- Assert on **shape and presence**, not on specific values. Coordinates, battery
  levels and timestamps all change; `_id` existing does not.
