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

Extended during the pre-push review: **this covers test fixtures and
documentation as much as code.** Real coordinates had accumulated in the geo,
signals, notifications and zone tests, and in a README example — including the
neighbour's actual 100m geofence, copied from the account at fifteen decimal
places. A third party's home location is not ours to publish. Coordinates now
come from `tests/fixtures/place.js`, invented by default and injectable via
`TEST_HOME_LAT`/`TEST_HOME_LON`; the runtime was already clean, taking home
from `pet.home_location` and the danger zone from the geofence API.


---

## Purpose

**P1** · agreed — The system answers one question: *is the cat in trouble right
now?* Everything else is in service of that or out of scope.

**P2** · agreed — The threat model is the enemy cat: fights, chases, standoffs,
and being cornered or trapped. Not theft, not general lost-pet recovery.

**P3** · agreed — Latency matters more than completeness. A late-but-perfect
signal is worthless; the point is to intervene while it's happening.

---

## The outing lifecycle

The core loop, and the thing every other behaviour hangs off.

**L1** · agreed — Sit on the channel **permanently**. Never poll: the REST API
rate-limits per resource after roughly two calls and reports it as HTTP 200
with an error body (**C7**).

**L2** · **done** — **A fresh GPS fix during a live sample means she is out.**
No geometry. Indoors, live tracking produces no fresh fixes at all — 55 seconds
of confirmed-active live tracking yielded only the same stale position re-sent
(**C17**); outdoors it produces one every four seconds. What was recorded as a
limitation turned out to be the discriminator.

Distance from home is used for exactly one thing: when fixes stop, telling
"walked back indoors" from "lost signal out there" — near home means home, far
means trouble. It cannot be used for anything else (**C31**).

*Implemented in `outing.js`, a pure state machine; driven from `server.js`.*

**L2-old** · superseded — There was no free leaving signal: zone exit
cannot fire (**C30**), distance cannot discriminate (**C31**), and normal mode
is ten minutes behind anyway (**C32**). Either a tight house geofence fires
promptly (**Q21**), or the trigger must be bought with battery — sampling live
briefly on a cycle, or simply staying live through her active hours. Acceptance
test, in the user's words: *a tracker placed on the garden table must be
recognised as "she is out" and put the tracker into live mode within a
reasonable time.*

**L2a** · agreed — Whatever the signal, it is a **trigger to look, not a
conclusion**.
On it, go live and check. If she is genuinely out, confirm; if it was a blip at
the edge of the house, stand down quietly.

```
HOME ──(zone exit / distance)──► VERIFYING ──┬─ confirmed → OUT
                                             └─ false     → HOME (silent)
OUT ──(home, sustained)──► HOME
```

**L3** · agreed — Notify **"Topina is out"** on confirmation, and on her
return. These are information, not alarms, and must feel different from one
(**N9**). They double as proof the system is alive.

**L4** · **done** — Live tracking stays on for the whole outing, **re-armed**
as the device's own 1800s timeout expires (**C11**). Re-arming needs no special
path: the state machine asks for live every tick, the snapshot reports whether
it is actually on, and a lapse simply gets asked for again. One fewer thing to
forget.

**L8** · **done** — **Charging means she is indoors** — but only when it says
`CHARGING`. A finished charge reads `NOT_CHARGING` while still plugged in
(**C33**), so the check is one-directional by design: it can confirm she is in,
never that she is out. The tracker is on a
charger most of the time she is in, so a charging state skips the sample
entirely — no command sent, no battery spent, no ambiguity.

**L9** · **done** — No toggling while she is out. Live stays on as long as
fixes arrive; sampling only resumes once she is home or the signal is lost.

**L5** · **done** — Manual control from the dashboard overrides automation for a
configurable hold, then reverts to automatic. `HELD_OFF` is permitted at any
time, including mid-outing — it is the user's call, not the system's.

**L6** · agreed — Holds must serve re-arming too: a `HELD_ON` longer than the
device timeout still needs re-arming, or the hold is a lie.

**L7** · provisional — Battery: notify every 10% (configurable). She is out
about an hour at a time, so drain is not expected to be a limit, but it is
unmeasured — one full outing under live tracking will tell us.

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

**F14** · agreed — Push notification to phone on detection, over **FCM** to a
purpose-built Android app in `app/`. *Implemented in `notify.js` (no SDK: a
signed JWT exchanged for an access token, then one POST) and `alerts.js`.*
Android only — iOS was explicitly out of scope, which removes the relay
complication entirely.

**F15** · **done** — Three tiers: `info` (out, back, signal restored, zone
entry), `warn` (elevated findings, battery steps), `alarm` (urgent findings,
signal lost, nearly flat battery). Only `alarm` goes at Android high priority.

**F31** · **done** — Every notification body stands alone: what happened, how
far from home, and the coordinates. Away from home there is no dashboard
(**N12**).

**F32** · **done** — Battery is reported each time it falls past a configurable
step, and only while she is out — a charging tracker losing a percent is not
news.

**F22** · agreed — A finding pushes when it **appears**, then stays quiet for a
cooldown even while it keeps firing. Detectors run every four seconds; a dozen
buzzes per incident trains you to ignore the phone, and an ignored alert is
worse than none.

**F23** · agreed — A failed push must never take the monitor down. Sending is
fire-and-forget with its errors logged.

**F24** · agreed — The **enemy zone** is read from the Tractive API — it
already exists there as a `DANGER` geofence named by the user, so there is
nothing to configure and it stays editable in the official app.

**F25** · agreed — Presence in the enemy zone is a **risk modifier, not an
alarm**. Measured over a week she is inside it 7.1% of the time; alarming on
entry would fire constantly. Inside it, thresholds tighten and findings
escalate a tier. A bare entry is at most quiet information.

**F26** · agreed — Zone membership requires **dwell** — consecutive fixes or
elapsed time inside — because the zone's nearest corner is 30m from home and
ordinary GPS scatter near the house crosses the boundary. Nine of eleven
apparent "visits" in a week were one or two fixes of jitter (**C27**).

**F27** · agreed — Notifications carry the facts in the body — what happened,
distance from home, coordinates — and **tap through to the Tractive app** at
`https://applink.tractive.com/`, which lands on her live map. We do not build a
map.

**F28** · **done** — Incidents are first-class: opened when a finding confirms,
extended while anything stays active, closed after quiet, stored with track,
peak values and duration.

**F29** · **done** — The dashboard can **export any time window** for offline
analysis. Analysis happens outside the system; the dashboard offers only light
labelling, not an analysis workbench.

**F30** · **done** — Silence from the service must itself be noticed. A dead
monitor looks exactly like a calm afternoon.

**F16** · **dropped.** Remote intervention — firing the buzzer from a
notification — was considered and rejected.

---

## Non-functional

**N1** · agreed — Runs on the existing K3s home server (Beelink, 192.168.0.43)
eventually, deployed via the ArgoCD GitOps flow like the other apps. Until it's
proven to show something real, it runs locally with `node`.

**N2** · agreed — Single cat, single tracker. No multi-pet abstraction.

**N3** · revised — LAN **and tailnet**, no authentication on the dashboard.
Originally LAN-only. In deployment it is published over Tailscale
(`tailscale serve --tcp 8100`, tailnet-only — *not* Funnel, so never on the
public internet), matching how the other services on that machine are
reached. The tailnet is a private network of the owner's own devices, so this
widens reach without exposing the page publicly. The dashboard still has no
authentication, so anything with tailnet access can see her live location —
acceptable while the tailnet holds only the owner's devices, and the reason
Funnel stays off.

**N4** · agreed — Credentials live in environment variables, never in the repo.

**N5** · agreed — **Zero runtime dependencies.** Node's built-ins only; no
frontend build step. Achieved by dropping the wrapper (**Q12**).

**N7** · agreed — All identifying values (credentials, pet and tracker IDs, user
id, pet name) are read from the environment through `config.js`. See **G3**.

**N9** · **done** — Every configuration point — thresholds, intervals, holds,
each detector's on/off — is **visible and editable in the dashboard**, and
survives a restart. Seeded from the environment once, then the stored value
wins, following the pattern already used by `showgrab`. Where a value came from
must be visible, since a later environment edit silently doing nothing is
otherwise baffling.

**N10** · **done** — Persistence is SQLite on a volume (`node:sqlite`, so still
zero dependencies), holding settings, meaningful events and incidents.

**N11** · agreed — **Never log keep-alives.** They arrive every 5 seconds and
carry nothing but liveness — 17,000 rows a day of nothing. A daily connection
summary says the same thing.

**N12** · agreed — The dashboard stays **LAN-only** for now (**D8** deferred).
Away from home, the notification and the Tractive app are the entire
experience, which is why the notification body must carry the facts on its own.

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

**C27** — **The enemy zone's edge is 30m from home**, so GPS scatter near the
house crosses it. Nine of eleven apparent visits in a week were one or two
fixes lasting under three minutes; only two were real. Any zone logic without
dwell will manufacture phantom entries daily.

**C28** — **The Tractive app claims every path on `applink.tractive.com`** but
only routes the root; deeper paths open the app showing an error. The root is
the tap target.

**C33** — **`NOT_CHARGING` does not mean "off the charger".** A finished
charge flips to `NOT_CHARGING` while still plugged in, so the field reads
identically on a dock and on the cat — verified by unplugging and seeing no
field change at all. Only the positive case is informative: `CHARGING` means
she is definitely indoors, `NOT_CHARGING` means nothing.

**C36** — **A stalled channel does not error.** The socket stays open and
silent, so `fetch` never rejects and the loop never reconnects. Only the
absence of keep-alives reveals it, which is why there is a sixty-second stall
timeout. This is the failure that would leave a healthy-looking service seeing
nothing.

**C37** — **Absent fields arrive as `null`, not as missing keys.** The REST
position report always carries a `speed` key; after live tracking has run it
mirrors a live fix, which has no speed, and the value is an explicit `null`.
Since `typeof null` is `'object'`, any "is it present?" check written as
`!== undefined` passes and then fails on the type. Optional fields must be
tested with `!= null`. Found by the e2e suite going red with
`'object' !== 'number'`; it costs nothing at runtime because the detectors use
speed derived from consecutive fixes, never the reported field.

**C38** — **An unhandled throw in a request handler kills the monitor.** The
HTTP handler is `async`, so nothing catches what it throws: `GET
/export?from=abc` produced `RangeError: Invalid time value` from
`new Date(NaN).toISOString()` and took the whole process down — verified
live. Two lessons, both now enforced: query values that reach a `Date` must
be validated (finite *and* within ±8.64e15, since `Number('9e99')` is finite
and still throws; `Number(' ')` is 0, not NaN), and the handler needs a
catch-all so no endpoint can ever end the process. A monitor that a mistyped
URL can kill is not a monitor (**D5**).


**C34** — **Charging transitions push promptly on the channel**, but only in
the direction that actually happens. Reconnecting produced `→ charging` within
seconds. Disconnecting a *full* tracker produced nothing, because no field
changed. So "just unplugged" cannot be used as a trigger: it would work when
the tracker was part-charged and be silent exactly when it wasn't — unreliable
in the worst way, appearing to work until it doesn't.

**C35** — Battery level is not a usable "in use" signal either. It takes about
an hour to fall from 100% to 99%, while the sampler checks every three minutes
regardless. It would be a worse signal arriving much later.

**C30** — **The garden is inside Tractive's wifi home zone.** The tracker kept
seeing home wifi from a garden table; `prioritized_zone` stayed `HOME` and
`entered_at` never changed. Zone exit cannot signal that she is out.

**C31** — **Distance from home cannot tell the house from the garden.** In the
same test, indoors reported 8m from the home point and the garden reported 2m.
At this property's scale the two are inside each other's noise, so no radius
separates them. Only live-mode precision could, and that is the thing we are
trying to decide when to enable.

**C32** — **Normal mode reports roughly every ten minutes, in batches.** Eight
minutes of a stationary tracker yielded two positions, delivered together. This
is the latency floor for anything built on normal-mode data, regardless of how
clever the trigger is.

**C29** — ~~SIGTERM does not stop the service.~~ **Fixed.** Three bugs, each
silent: the handler referenced a variable that no longer existed and threw on
its first line; `fetch` has no timeout so turning live off could hang forever;
and the handlers were registered *after* a top-level `for await` loop that
never returns, so they were never registered. Now guarded by a hard deadline,
a timeout on the live-off call, and destroying SSE clients that would otherwise
hold `server.close()` open.

**C26** — **Every position in a week of history came from GPS** — 6,403 of
6,403, no cell or wifi fallback once. The `no-gps` detector has therefore never
had an opportunity to fire, and its usefulness is unproven rather than
established.

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

**D1** · **done** — **The token cache must survive restarts.** This is the single
most important deployment constraint and it is not obvious. Without persistence
every pod restart is a real login, and a crash-looping pod would hammer the auth
endpoint and lock the account out of the API entirely (**C20**) — taking the
monitoring down in a way that a restart cannot fix. Needs a PVC, and the cache
path must be configurable rather than the working directory.

**D2** · **done** — Back off on auth failure (30s → 2m → 10m → 30m, capped). Pair with **D1**: persistence stops
the common case, backoff stops the pathological one.

**D3** · **done** — `TRACTIVE_PASSWORD` goes in a Kubernetes Secret, never in a
manifest. So does the FCM service-account key. `showgrab` keeps its config as plain env in the deployment, which is
fine for a feed URL and not for a credential.

**D4** · **done** — **Single replica.** Two pods would hold two channels and
fight over live tracking, each turning it off under the other.

**D5** · **done** — A health endpoint whose meaning is *the channel is
connected and events are arriving*, not merely that the process is alive. A
monitor that has silently stopped monitoring is the failure worth catching, and
process liveness would not catch it.

**D6** · **done** — `enableServiceLinks: false`. Kubernetes injects
`<SERVICE_NAME>_PORT` env vars for every Service in the namespace; `showgrab`
crash-looped on exactly this when the injected variable collided with its own.
Our variables are `TRACTIVE_*` and `PET_NAME` so a `topina` Service would not
collide today, but the failure is silent enough to be worth pre-empting.

**D7** · **decided — off.** `RECORD_DIR` is unset in production, so no raw log
is kept there; recordings are made deliberately with `npm run record`. Writing
them without a volume behind it would fill the container's writable layer and
lose them on restart anyway. Revisit if the tuning corpus needs to grow
passively.

**D8** · resolved — Reaching the dashboard from outside the LAN. Answered by
Tailscale rather than by an ingress: the Service is published to the tailnet
with `tailscale serve --tcp 8100`, so the phone reaches it from anywhere
without the page ever being public (**N3**). Funnel stays off deliberately —
there is still no authentication and the page shows her live location. No
ingress, no certificate, no port forward on the router.

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

**Q16** — ~~What is her normal territory?~~ **Answered, and the answer
invalidated the threshold.** Over a week (6,403 positions): p50 **14m**, p95
47m, p99 62m, all-time max **142m**. The 150m threshold **could never fire** —
it was dead code. Her range has a hard edge: 60m catches 89 fixes, 70m catches
5. Now set to 80m. `npm run territory [days]`.

**Q17** — ~~Is the sprint threshold right?~~ (was **Q15**) **Answered with her
own data.** From 5,866 dense fixes: median 0.19 m/s, p99 1.49, p99.9 3.89, max
**9.38**. The 2.5 guess would have fired 16 times a week. Swept by distinct
events per week — 2.0→19, 2.5→16, 3.0→9, 3.5→6, 4.0→5, 5.0→2 — and set to
**3.0**, erring toward noticing. Still unknown whether any of those nine events
was actual danger; that needs an incident we can identify.

**Q19** — ~~Do zone crossings arrive as channel events?~~ **Answered: no, not
usefully.** Eight minutes with the tracker on a garden table produced six
status messages and **two** distinct positions, all in one burst. The home zone
stayed `HOME` throughout with `entered_at` unchanged — the tracker saw home
wifi from the garden, so there is no crossing to detect (**C30**). Distance
from home was *inverted*: 8m indoors, 2m in the garden (**C31**). And normal
mode reports roughly every ten minutes, which is a floor no trigger can beat
(**C32**).

**Q21** — Does a **tight geofence around the house** fire promptly on crossing?
The garden falls outside such a fence even though it is inside the wifi home
zone, and the enemy fence already carries `IN_TO_OUT`/`OUT_TO_IN` triggers, so
the mechanism exists. If the device evaluates fences locally and reports
crossings immediately — as an escape alert would have to — it beats the
ten-minute cadence and the cheap trigger survives. If not, the trigger has to
be bought with battery. **This is now the deciding question.**

~~**Q19 original**~~ — The home zone and
the enemy geofence both carry `IN_TO_OUT`/`OUT_TO_IN` triggers, and the tracker
records `prioritized_zone_entered_at`. If crossings are pushed, "she is out"
costs nothing and arrives promptly. If not, the fallback is distance-from-home
on low-resolution fixes, which is slower and less certain. **This decides how
much of the outing lifecycle is easy, and it is cheap to test.**

**Q20** — How fast does live tracking actually drain the battery? Unmeasured.
One full outing answers it.

**Q18** — She is never outside at night. Fixes more than 30m from home cluster
at 08:00 (24%), 12:00 (41%), 13:00 (17%) and 16:00 (10%), and are effectively
zero from 19:00 to 07:00. Should monitoring simply be idle overnight, and does
that change what live tracking costs?

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
