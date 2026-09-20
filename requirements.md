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
obtain a bearer token, **caching it to disk** and reusing it until near expiry
(**C20**). *Implemented in `auth.js`.*

**F2** · agreed — Maintain a persistent connection to the push channel and
consume position, hardware and tracker-state events as they arrive.
*Implemented in `channel.js`.*

**F3** · agreed — Survive connection drops and token expiry without manual
intervention: reconnect on disconnect, re-authenticate on 401.
*Implemented in `channel.js`; the reconnect path is not yet proven under a real
disconnect.*

**F4** · agreed — Persist every received event to an append-only log. This is
the corpus for tuning detector thresholds later. *Implemented in `record.js`;
recordings land in `data/` and are gitignored (**G3**).*

**F5** · agreed — Assume live tracking is always on. Do not build on/off control.
*(A better mechanism is coming; this is settled until then.)*

### Signal derivation

**F6** · agreed — Derive per-fix signals from the position stream: staleness,
speed, thrash ratio, distance from home, accuracy, sensor type. Speed **must**
be derived, since live fixes carry none (**Q3**). *Implemented in `signals.js`,
all pure functions with the clock injected.*

**F7** · agreed — Maintain a rolling window of recent fixes, trimmed by the
tracker's clock. *Implemented in `signals.js`; 60s, which at a 4s cadence is
~15 fixes.*

**F18** · agreed — The signal pipeline reads from an interchangeable source, so
a recording replays through exactly the same code as a live connection
(`sources.js`). This is how detectors get tuned without needing a cat, weather
and an incident to coincide — and it immediately earned itself by exposing the
thrash defect in **C24**.

**F17** · agreed — Merge channel events into a running tracker state rather than
replacing it, since events are partial (**C16**), and deduplicate positions on
`time` (**C18**).

**F8** · open — Additional signals to be added as they prove useful: distance to
the rival's known haunt, altitude delta, time-of-day. Which ones earn their place
depends on what the data shows.

### Presentation

**F9** · agreed — A web dashboard showing derived signals **live**, as
time-series traces. This is the primary surface. Its purpose in the early steps
is diagnostic: to let us watch the numbers and the cat simultaneously and learn
what distress looks like. *Implemented: `server.js` + `dashboard.html`, SSE, no
dependencies and no build step.*

**F10** · agreed — The map is secondary context, not the centrepiece. The
official app already does maps.

**F11** · agreed — Current values displayed prominently alongside the traces:
speed, thrash, staleness, distance from home, sensor, battery. *Implemented.*

**F19** · agreed — Charts use **fixed** scales with bands drawn from measured
data. Auto-scaling — the default in every charting library — would zoom into a
calm cat's noise until it looked dramatic.

**F20** · agreed — A gap in the data is drawn as a **break in the line**, never
interpolated across. Silence is the signal we most want to see.

### Detection

**F12** · provisional — Detectors that classify the live signal stream into
states (calm / elevated / alarm). Thresholds derive from observed data, not
guesses. **Unblocked, with measured reference points** from a guided walk
(lag-corrected, tracker held in hand, light rain):

| pace | median m/s | max m/s |
|---|---|---|
| standing still | 0.15 | **0.23** |
| walking slowly | 0.69 | 0.78 |
| walking normally | 1.00 | 1.27 |
| jogging / bursts | 1.52 | 1.58 |

Still never exceeds 0.23 m/s; walking runs 0.95 m/s median — **4.2x
separation**. A "moving" threshold around 0.4 m/s separates cleanly. A cat
sprint is 3-8 m/s, far above anything measured here, so a sprint detector has
ample headroom. Real incident data is still needed for the upper bounds. *Implemented in
`detectors.js`; thresholds in one `DEFAULTS` object so a change is one line and
can be re-evaluated against the whole corpus by replay.*

**F21** · agreed — A condition must hold for `sustain` consecutive readings
before it escalates, so one noisy fix cannot raise an alarm. Clearing is
immediate: being slow to notice trouble is worse than being quick to relax.

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

**N5** · agreed — **Zero runtime dependencies.** Node's built-ins only; no
frontend build step. Achieved by dropping the wrapper (**Q12**).

**N7** · agreed — All identifying values (credentials, pet and tracker IDs, user
id, pet name) are read from the environment through `config.js`. See **G3**.

**N8** · agreed — A real login is a rare event, not a per-run cost. Code calls
`session()`; `authenticate()` is reserved for genuine renewal (**C20**).

**N6** · open — Availability expectations. The system is useless if it's down
during a walk, but we haven't decided how hard to work for uptime.

---

## Constraints

**C1** — The Tractive API is undocumented and unofficial. Endpoints and the baked-in
client ID can break without warning.

**C2** — Auth accepts only `grant_type=tractive` (email + password). No Google or
Apple SSO. Accounts created via SSO need a password set through the
forgot-password flow.

**C3** — ~~GPS accuracy is typically 5-20m... this is the central technical
risk.~~ **Measured and wrong.** A stationary outdoor tracker in live mode holds
**sub-metre** precision: 95% of fixes within 0.8m of true position, apparent
movement between fixes never above 0.7m, noise in derived speed never above
0.28 m/s. A walking cat is ~1 m/s and a sprinting one 3-8 m/s, so movement
heuristics have an order of magnitude of headroom. **This risk is closed for
open-sky conditions.** It is not closed for a cat under a car, a hedge, or a
shed — that case is **Q14**.

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

**C20** — **The auth endpoint rate-limits hard.** A handful of logins in quick
succession returns HTTP 429 with `code: 4006` and **no `Retry-After` header**.
Observed lockout: **over 20 minutes**. Authenticating per process run is not
viable. `auth.js` caches the token to `.token.json` (gitignored, mode 600) and
reuses it until an hour before expiry; a renewal refused while the current
token is still valid falls back to the current token.

**C22** — **Reported position lags real motion by about 8 seconds** (two fixes).
Measured on a guided walk: speed does not rise until two fixes after walking
starts, and the two fastest readings of the whole recording land two fixes
*after* the running stopped. The device appears to smooth positions. Every
consequence follows from this: detection is ~8s behind reality, alerts will
clear ~8s late, and any analysis that trusts a label at a phase boundary will
put sprint speeds in the "standing still" bucket. **This is the floor on how
"immediate" notification can ever be.**

**C25** — **Windowed signals keep alarming after the event ends.** Thrash is
computed over a trailing 60s window, so replaying the walk showed it alarming
through a full minute of standing perfectly still — the window still remembered
the jogging. Any alarm built on a windowed signal must also require the
condition to be true *now*; thrash additionally requires current speed above
`moving`. Without that, an alert cannot be trusted to mean "happening", only
"happened recently".

**C24** — **Thrash ratio is only meaningful while actually moving.** A
stationary tracker's sub-metre jitter accumulates path length while going
nowhere, which scores exactly like a scuffle: replaying a real recording showed
standing still rating 2.4-3.4 against walking's 1.3-1.6 — inverted. The ratio
is now gated on average speed across the window clearing `MOVING_MS` (0.4 m/s,
which sits in the measured gap between 0.23 still and 0.69 walking slowly).
Gated, it reads null when still, ~1.3 walking in a line, and 5.7-8.8 when
jogging around a confined space — which is the signature a scuffle should have.

**C23** — Movement recordings must not be analysed as noise. Spread from a
centroid measures how far someone walked, not GPS error. `analyse.js` reports
the noise-floor interpretation only for stationary recordings.

**C21** — A lockout affects *only* the auth endpoint. Existing tokens keep
working, and a token obtained elsewhere — from the Tractive web app's
`Authorization` header — works immediately. `npm run token -- <token>` verifies
one and installs it, which is the escape hatch when locked out and the way to
bootstrap without ever calling auth.

**C11** — The tracker has `custom_lt_timeout: 1800` — live tracking ends after 30
minutes at the device level.

**C12** — Field names differ between the REST report and the channel event for
the same quantity: position accuracy is `pos_uncertainty` on
`device_pos_report`, and `accuracy` on a channel position event. Anything
reading both must normalise.

**C13** — A position report reverse-geocodes to a street address. Useful context
when an alert fires, and a reason to keep probe output out of the repo (**G3**).

**C14** — A channel position carries **two** timestamps on **two different
clocks**: `time` (the tracker's) and `time_rcvd` (the server's). They differ by
minutes on a stale fix, and `time_rcvd` has been observed **7 seconds behind**
`time` — so they cannot be mixed in one calculation. Intervals between fixes
must use `time` throughout; staleness relative to now is the one thing `time`
cannot honestly answer.

**C16** — **Channel events are deltas, not snapshots.** The first
`tracker_status` after connect is complete; subsequent ones carry only changed
fields (often just `tracker_id`, `tracker_state` and the one control that
moved). A consumer that replaces its state on each event silently loses
position and hardware data. State must be *merged*.

**C17** — **Indoors, live tracking produces no fixes.** Live mode was confirmed
active (`active: true`, `remaining: 1794`) for ~55 seconds with the cat inside,
and not one new position arrived — only the same stale fix re-sent. GPS can't
see sky through a roof. Harmless for the product (the point is outdoor walks)
but it means **every cadence and noise-floor measurement must be taken
outdoors**, and the stationary test in step 4 has to be outdoors too.

**C18** — The same position is re-sent with an identical `time`. Consumers must
deduplicate on `time`, or every repeat registers as a zero-distance,
zero-elapsed fix and poisons the speed calculation with a division by zero.

**C19** — Commands are acknowledged asynchronously in two stages: a
`tracker_status` with `pending: true`, then one with `active: true` and a
`started_at`. `remaining` counts the device-level timeout down from 1800.

**C15** — Authentication now exists twice: the wrapper's (used by the REST calls)
and ours in `auth.js` (used by the channel, because the wrapper hides the client
ID and keeps its token on `globalThis`). Tolerable for now, resolved by **Q12**.

---

## Deployment (step 9)

Target is the existing K3s home server, following the same GitOps pattern as
`showgrab`: a kustomize base in `apps/topina/`, an overlay in
`overlays/prod/topina/`, and ArgoCD syncing from git. Image published to GHCR,
with Argo CD Image Updater bumping semver tags on GitHub release.

**D1** · agreed — **The token cache must survive restarts.** This is the single
most important deployment constraint and it is not obvious. Without persistence
every pod restart is a real login, and a crash-looping pod would hammer the auth
endpoint and lock the account out of the API entirely (**C20**) — taking the
monitoring down in a way that a restart cannot fix. Needs a PVC, and the cache
path must be configurable rather than the working directory.

**D2** · agreed — Back off on auth failure. Pair with **D1**: persistence stops
the common case, backoff stops the pathological one.

**D3** · agreed — `TRACTIVE_PASSWORD` goes in a Kubernetes Secret, never in a
manifest. `showgrab` keeps its config as plain env in the deployment, which is
fine for a feed URL and not for a credential.

**D4** · agreed — **Single replica.** Two pods would hold two channels and
fight over live tracking, each turning it off under the other.

**D5** · provisional — A health endpoint whose meaning is *the channel is
connected and events are arriving*, not merely that the process is alive. A
monitor that has silently stopped monitoring is the failure worth catching, and
process liveness would not catch it.

**D6** · agreed — `enableServiceLinks: false`. Kubernetes injects
`<SERVICE_NAME>_PORT` env vars for every Service in the namespace; `showgrab`
crash-looped on exactly this when the injected variable collided with its own.
Our variables are `TRACTIVE_*` and `PET_NAME` so a `topina` Service would not
collide today, but the failure is silent enough to be worth pre-empting.

**D7** · open — Whether recordings (**F4**) are written in production at all. A
PVC keeps the tuning corpus growing; the alternative is recording only during
deliberate sessions. They contain coordinates either way (**G3**).

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

**Q1** — ~~What is the real fix interval in live mode?~~ **Answered:** median
**4s**, p95 5s, max 11s, over 39 fixes outdoors. The claimed 2-5s is real.

**Q2** — ~~What is the stationary noise floor?~~ **Answered: ~0.5m.** Spread
from centroid median 0.52m, p95 0.75m, max 1.11m. Apparent movement per fix p95
0.58m. **F12 is unblocked.**

**Q3** — ~~Does the `speed` field arrive populated?~~ **Answered, corrected.**
An earlier reading of "never present in live mode" was an artefact of a
stationary recording: `speed` appears **only when the tracker is moving** and is
absent when it is still. When present it is **unreliable** — 0.1 m/s reported
while the tracker was demonstrably doing 1.52 m/s. Deriving speed ourselves is
mandatory, now for a better reason: the field is both intermittent and wrong.

**Q4** — ~~Does accuracy vary enough to be worth gating detectors on?~~
**Answered: no, not in live mode.** Once the fix settles, `accuracy` is `0` for
39 of 39 fixes (max 1). It carried `9` on the stale REST report, so it means
something during acquisition, but it is not a usable live quality gate.

**Q15** — Is the sprint threshold right? It is set at 2.5 m/s, and the fastest
reading in the walk recording was **2.49** — a jogging human came within a
hundredth of tripping it. Either the threshold is too low for a cat's ordinary
trot, or smoothing is flattening real peaks. Needs her own data.

**Q16** — What is her normal territory? `far-from-home` uses a flat 150m radius
because no baseline exists. Pulling 30-90 days of history would turn it into
"unusual *for her*" rather than an arbitrary circle.

**Q14** — What does the noise floor look like under cover — beneath a car, in a
hedge, behind a shed? **Q2** measured open sky in a garden. Degraded conditions
are exactly when a cornered cat matters most, and `sensor_used` dropping from
GPS is the signal to watch.

**Q5** — ~~What else arrives on the channel, and how chatty is it?~~ **Answered
in part:** `handshake` on connect, then a `tracker_status` full-state snapshot,
then `keep-alive` every 5 seconds. What arrives *during activity* is still
unknown — it needs live tracking on and the cat outdoors.

**Q6** — ~~How long is a token valid?~~ **Answered:** ~60 days. What expiry looks
like in practice is still unknown.

**Q9** — Where is `VEDBA_METRICS` exposed, and at what resolution? **Probed, not
found.** Guessed paths under both `graph.tractive.com/4/` and
`aps-api.tractive.com/api/1/` (`vedba`, `vedba_metrics`, `metrics`, `activity`,
on both tracker and pet) returned 404 or nothing. The capability is advertised by
the *device*; it may be consumed internally, pushed over the channel, or exposed
only to the mobile app. Next check is the channel itself (step 3). Definitive
answer would need intercepting the mobile app's traffic — a bigger detour.

**Q12** — ~~Keep the `tractive` wrapper at all?~~ **Answered: no, removed.**
The project now has zero runtime dependencies. The wrapper's `getPet`
dereferences `details` without a guard, so a rate-limited response crashed
inside the library instead of returning an error we could handle — that was the
deciding failure. Its calls are reimplemented in `rest.js`, sharing one auth
path with the channel. **C8**, **C9** and **C15** are closed with it.

**Q13** — ~~Does a `tracker_status` snapshot arrive only on connect, or also on
change?~~ **Answered:** on change, and as a **partial** message carrying only
the fields that changed. Control state is observable for free. See **C16**.

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
