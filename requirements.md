# Requirements

Living document. Requirements get added and revised as we learn what the data
actually supports — several below can't be finalised until the noise floor test
(step 4) tells us what's measurable.

Status: **agreed** · **provisional** (direction set, details unknown) ·
**open** (needs a decision) · **deferred** (deliberately not now)

---

## Ground rules

Non-negotiable, for every change to this repo.

**G1** — **Update this document.** Any change that adds, removes, or revises a
requirement, constraint, or open question is not done until it's reflected here.

**G2** — **Update the tests.** Any new capability gets end-to-end coverage in
`tests/e2e/`, one file per plan step. Any changed behaviour gets its assertions
changed with it.

**G3** — **Treat this repo as public.** Nothing identifying is ever hardcoded:
not the pet's name, not pet or tracker IDs, not coordinates, not addresses, not
account details. It all comes from the environment via `config.js`, and only
`.env.example` — with empty values — is committed. Probe output pasted into
issues or docs gets scrubbed first.

---

## Purpose

**P1** · agreed — The system answers one question: *is the cat in trouble right
now?* Everything else is in service of that or out of scope.

**P2** · agreed — The threat model is the enemy cat: fights, chases, standoffs,
and being cornered or trapped. Not theft, not general lost-pet recovery.

**P3** · agreed — Latency matters more than completeness. A late-but-perfect
signal is worthless; the point is to intervene while it's happening.

---

## Functional

### Data acquisition

**F1** · agreed — Authenticate against the Tractive API with email + password and
obtain a bearer token.

**F2** · agreed — Maintain a persistent connection to the push channel and
consume position, hardware and tracker-state events as they arrive.

**F3** · agreed — Survive connection drops and token expiry without manual
intervention: reconnect on disconnect, re-authenticate on 401.

**F4** · agreed — Persist every received event to an append-only log. This is
the corpus for tuning detector thresholds later.

**F5** · agreed — Assume live tracking is always on. Do not build on/off control.
*(A better mechanism is coming; this is settled until then.)*

### Signal derivation

**F6** · agreed — Derive per-fix signals from the position stream: staleness,
speed, thrash ratio, distance from home, accuracy, sensor type.

**F7** · provisional — Maintain a rolling in-memory window (~10 min) of recent
fixes, sufficient for all windowed signals.

**F8** · open — Additional signals to be added as they prove useful: distance to
the rival's known haunt, altitude delta, time-of-day. Which ones earn their place
depends on what the data shows.

### Presentation

**F9** · agreed — A web dashboard showing derived signals **live**, as
time-series traces. This is the primary surface. Its purpose in the early steps
is diagnostic: to let us watch the numbers and the cat simultaneously and learn
what distress looks like.

**F10** · agreed — The map is secondary context, not the centrepiece. The
official app already does maps.

**F11** · provisional — Current values displayed prominently alongside the
traces: speed, thrash, staleness, battery, accuracy, sensor type.

### Detection

**F12** · provisional — Detectors that classify the live signal stream into
states (calm / elevated / alarm). Thresholds derive from observed data, not
guesses — this requires step 4 and real incident observations first.

**F13** · open — Detector tuning is expected to be iterative and ongoing. The
system must make it cheap to change a threshold and re-evaluate it against the
logged corpus.

### Alerting

**F14** · deferred — Push notification to phone on detection. Mechanism
undecided (ntfy / Telegram / Pushover / Home Assistant companion app). Not being
built now.

**F15** · deferred — Escalation tiers, so that a minor anomaly and "she's being
attacked" don't feel the same.

**F16** · deferred — Remote intervention: fire the tracker's buzzer or LED from
the dashboard or from an alert, to break up a standoff. The API supports it.

---

## Non-functional

**N1** · agreed — Runs on the existing K3s home server (Beelink, 192.168.0.43)
eventually, deployed via the ArgoCD GitOps flow like the other apps. Until it's
proven to show something real, it runs locally with `node`.

**N2** · agreed — Single cat, single tracker. No multi-pet abstraction.

**N3** · agreed — LAN only, no authentication on the dashboard, for now.

**N4** · agreed — Credentials live in environment variables, never in the repo.

**N5** · provisional — Minimal dependencies. Node's built-ins where possible; no
frontend build step.

**N7** · agreed — All identifying values (credentials, pet and tracker IDs, pet
name) are read from the environment through `config.js`. See **G3**.

**N6** · open — Availability expectations. The system is useless if it's down
during a walk, but we haven't decided how hard to work for uptime.

---

## Constraints

**C1** — The Tractive API is undocumented and unofficial. Endpoints and the baked-in
client ID can break without warning.

**C2** — Auth accepts only `grant_type=tractive` (email + password). No Google or
Apple SSO. Accounts created via SSO need a password set through the
forgot-password flow.

**C3** — GPS accuracy is typically 5-20m and degrades under cover. **A cat fight
three metres away is inside the noise floor.** Position alone may not distinguish
"fighting" from "sitting" — this is the central technical risk.

**C4** — Live tracking mode gives ~2-5s fixes but drains the tracker battery in
hours. Normal mode is 2-60 minutes, far too coarse.

**C5** — No microphone, no camera. We cannot *hear* a fight. But the tracker
advertises a `VEDBA_METRICS` capability — VeDBA is an accelerometer-derived
measure of movement intensity — so some motion signal beyond GPS may be
reachable. Where it's exposed is **Q9**. If it is, it's a far better distress
signal than position and partially defuses **C3**.

**C6** — Activity and sleep data from the API are daily aggregates. Too coarse for
live detection; possibly useful as baseline cross-checks.

**C7** — The REST API rate-limits **per resource after roughly two calls in quick
succession**, and returns the limit as HTTP 200 with a body of
`{"code":4006,"category":"REQUEST","message":"Rate limit for this resource exceeded."}`.
It therefore looks like missing data, not an error. Polling is effectively off
the table; this validates the push-channel design. Tests must call each endpoint
at most once per run.

**C8** — The `tractive` wrapper has no channel support, no token refresh, and
holds state in `globalThis`. Used for auth and REST bootstrap; the channel client
is ours.

**C9** — **The published npm package `tractive@1.2.1` is broken. Install from
GitHub (`npm i github:FAXES/tractive`).** The npm build is stale CommonJS with an
older client ID (`625e533dc3c3b41c28a669f0`), `getPets()` returns an unparsed
JSON string, and `getAllTrackers()` never resolves its promise — it writes the
response to stdout instead. GitHub `main` is a fetch/ESM rewrite that works and
was never published.

**C10** — Auth returns no refresh token, only `access_token` + `expires_at`.
Renewal means re-authenticating with the password, so the password must stay
available to the running service.

**C11** — The tracker has `custom_lt_timeout: 1800` — live tracking ends after 30
minutes at the device level.

**C12** — Field names differ between the REST report and the channel event for
the same quantity: position accuracy is `pos_uncertainty` on
`device_pos_report`, and `accuracy` on a channel position event. Anything
reading both must normalise.

**C13** — A position report reverse-geocodes to a street address. Useful context
when an alert fires, and a reason to keep probe output out of the repo (**G3**).

---

## Non-goals

**X1** — Session replay, walk history, track visualisation after the fact.
Explicitly not wanted.

**X2** — Anything the official app already does well: current location, walk
summaries, activity goals, battery monitoring as a feature in its own right.

**X3** — Multi-user, sharing, accounts, mobile-native apps.

**X4** — Lost-pet recovery workflows.

---

## Open questions

Answered by running the early steps:

**Q1** — What is the real fix interval in live mode? (2-5s is claimed.)

**Q2** — What is the stationary noise floor, in metres? This determines whether
**C3** kills the movement heuristics. *Blocks F12.*

**Q3** — ~~Does the `speed` field arrive populated?~~ **Answered:** yes, as a
number (`0.5` observed on an apparently stationary cat). Whether it beats our
own derived speed is still open, and that `0.5` is itself a hint about noise.

**Q4** — Does accuracy vary enough to be worth gating detectors on? First
observation: `pos_uncertainty: 9` (metres) on a GPS fix. Still need the spread.

**Q5** — What else arrives on the channel, and how chatty is it?

**Q6** — ~~How long is a token valid?~~ **Answered:** ~60 days. What expiry looks
like in practice is still unknown.

**Q9** — Where is `VEDBA_METRICS` exposed, and at what resolution? **Probed, not
found.** Guessed paths under both `graph.tractive.com/4/` and
`aps-api.tractive.com/api/1/` (`vedba`, `vedba_metrics`, `metrics`, `activity`,
on both tracker and pet) returned 404 or nothing. The capability is advertised by
the *device*; it may be consumed internally, pushed over the channel, or exposed
only to the mobile app. Next check is the channel itself (step 3). Definitive
answer would need intercepting the mobile app's traffic — a bigger detour.

**Q11** — `health/overview` returns `restingHeartRate` and
`restingRespiratoryRate` (both `{status, dayOffset}`, e.g. `NORMAL`). Is there a
finer-grained or live version of these? A heart-rate spike would be an excellent
distress signal, but a daily `NORMAL`/`dayOffset:-1` is not.

**Q10** — The tracker supports `CIRCLE`, `RECTANGLE` **and `POLYGON`** geofences
server-side. Is it better to define enemy territory as a Tractive geofence and
consume the events, or to do point-in-polygon ourselves from the position stream?

Answered only by observing real incidents:

**Q7** — Does a fight or chase produce a distinguishable signature at all?

**Q8** — What does a false positive look like — and how often? (Birds, other
cats, sprinting for fun.)
