# Topina

Live distress monitoring for a cat's outdoor walks.

## The problem

The cat goes out for walks. There is an enemy cat. The official Tractive app shows
where she is, but not **what is happening to her** — and it shows it late. We need
to know immediately if there are signs of a fight, a chase, or any other dangerous
or stressful situation.

This is explicitly **not** a reimplementation of the official app. We are not
rebuilding the map, the walk history, or the activity charts. The only thing this
system exists to do is turn a stream of GPS fixes into an answer to *"is she in
trouble right now?"*

## Approach

The Tractive REST API is poll-only, but there is a push channel the community
wrapper doesn't expose:

```
POST https://channel.tractive.com/3/channel
Authorization: Bearer <token>
→ streaming NDJSON, one event per line
```

It pushes `position`, `hardware`, `tracker_state` and `health_overview` messages
plus keep-alive heartbeats. This is the live feed. Combined with live tracking
mode (~2-5s fixes), it's the raw material for everything below.

From each position fix we derive signals — speed, thrash ratio, staleness,
distance from home — and watch them for patterns that mean distress.

### Day one builds an instrument, not an alarm

We cannot tune a threshold for a signal we have never seen. Neither we nor anyone
else knows what a cat fight looks like in Tractive data, or whether it looks like
anything at all. So the early steps make the signals **visible in real time**,
so they can be correlated against what's actually happening in the garden. Only
then do thresholds become real instead of guessed.

## Plan

Phase one answered *can this work at all*. It did: the noise floor is sub-metre,
the channel is a usable live feed, detectors fire on real movement, and an
alert reaches a phone. All of it is below under "what each step told us".

Phase two is a different question — **can it run unattended for weeks and be
worth trusting**. The shape it has to take:

> Sit on the channel permanently. When she leaves, verify by going live, and
> stay live for the whole outing. Tell me she is out. Watch for trouble, more
> closely inside the enemy's territory. Record everything worth keeping. Let me
> change any of it from the dashboard, and survive a reboot.

| # | Step | Done when |
|---|---|---|
| ✅ 1 | **Zone-exit signal** | Answered: **no usable signal**. Garden is inside the wifi home zone; distance is inverted; normal mode is ~10 min behind |
| ⚠️ 2 | **How to know she is out** | ~~A fresh GPS fix during a live sample~~ — **wrong, corrected 2026-09-21.** A docked tracker produces them by the hundred. Now: a docked latch and retraction on stillness, with a fresh fix as evidence rather than proof |
| ✅ 3 | **Outing state machine** | `outing.js`, pure and tested; drives live tracking from `server.js` |
| ✅ 4 | **Clean shutdown** | SIGTERM stops the service *and* turns live tracking off |
| ✅ 5 | **Persistence** | SQLite on disk: settings, state, events — surviving restarts |
| ✅ 6 | **Dashboard controls** | Every threshold visible, editable, toggleable; manual live hold with a countdown |
| ✅ 7 | **Enemy zone** | Read from the Tractive API, applied as a risk modifier with a dwell requirement |
| ✅ 8 | **Notification tiers** | Out / back / battery / elevated / alarm, each feeling different |
| ✅ 9 | **Incidents + export** | Incidents as objects; download any time window for offline analysis |
| ✅ 10 | **Watchdog** | Silence from the service is itself noticed |
| 11 | **Deploy to the Beelink** | Running in K3s via ArgoCD, with a volume |
| 12 | **Security review before pushing** | Everything committed-but-unpushed has been reviewed and is safe to make public |

Step 12 is not a formality. This repository is public, the work has touched
credentials, a service-account key, a cat's home coordinates and a live
location feed, and commits have accumulated locally. Nothing goes up until
someone has looked at the whole diff with that in mind.

Step 1 is done and the answer was no, which is why step 2 exists at all.

**What step 1 found.** Eight minutes with the tracker on a garden table
produced two positions. The home zone never changed — the tracker sees home
wifi from the garden. Distance from home was inverted: 8m indoors, 2m in the
garden. And normal mode reports about every ten minutes regardless. So there is
no free signal that she has gone out, and the design cannot assume one.

## What step 1 told us

Auth works and `npm test` is green. What we learned beyond "it connects":

- **The npm package is broken — install from GitHub.** `tractive@1.2.1` on npm is
  stale CommonJS with an older client ID; `getPets()` returns an unparsed string
  and `getAllTrackers()` never resolves. GitHub `main` is a working fetch/ESM
  rewrite that was never published. `package.json` pins `github:FAXES/tractive`.
- **Rate limiting is aggressive and silent.** Roughly two calls to the same
  resource in quick succession and you get HTTP 200 with a body of
  `{"code":4006,"message":"Rate limit for this resource exceeded."}`. It looks
  like missing data, not an error. Polling is effectively dead — this validates
  building on the push channel.
- **Tokens last ~60 days**, with no refresh token. Renewal = re-auth with the
  password.
- **Home location comes free.** The pet record carries
  `home_location: [lat, long]`, so "distance from home" needs no configuration.
- **The tracker supports polygon geofences** — `CIRCLE`, `RECTANGLE`, `POLYGON`.
  Enemy territory doesn't have to be approximated as a circle.
- **`VEDBA_METRICS` is in the tracker's capability list, but we can't reach it.**
  VeDBA is an accelerometer-derived measure of movement intensity — a much better
  distress signal than GPS if we could get it. Probing every plausible endpoint
  on both API hosts found nothing. See **Q9**.
- **Careful probing `graph.tractive.com`: it returns `200 []` for any unknown
  path under `tracker/{id}/`.** `tracker/<id>/banana` returns an empty array,
  not a 404. Endpoint discovery there needs a nonsense-path control every time.
  `aps-api.tractive.com` returns honest 404s.
- **`health/overview` on `aps-api.tractive.com` carries more than the HA
  integration exposes** — including `restingHeartRate` and
  `restingRespiratoryRate` status. Daily granularity, so not live, but noted.
- Tracker is a **TG7A** on firmware `011.092`, live tracking (`LT`) supported,
  with a device-level live-tracking timeout of 1800s.

## What step 2 told us

A one-shot `device_pos_report` comes back complete and usable:

- **`speed` arrives populated as a number** — `0.5` on a cat that was almost
  certainly sitting still, which is itself a warning about the noise floor.
- **Accuracy is `pos_uncertainty`, in metres** — `9` on a clean GPS fix. Set
  that against a cat fight happening three metres away (**C3**).
- `altitude`, `sensor_used` (`GPS`) and a seconds-resolution `time` are all
  present, and the report reverse-geocodes to a street address.
- The fix was **16 minutes old** — normal reporting cadence, not live mode.
  Confirms how coarse the default interval is (**C4**).
- `home_location` from the pet record works as a reference point; distance from
  home computed cleanly on the first try.
- **Field names differ between REST and the channel** for the same quantity:
  `pos_uncertainty` here, `accuracy` on a channel event (**C12**).

## What step 3 told us

**The channel works.** `POST channel.tractive.com/3/channel` holds open and
streams NDJSON. Implemented in [channel.js](channel.js), driven by
`npm run listen [seconds]`.

What arrives:

```
  1.0s  handshake
  1.1s  tracker_status    ← full state snapshot
  4.8s  keep-alive
  9.8s  keep-alive        ← every 5s, exactly
```

The `tracker_status` snapshot is richer than expected — position, hardware,
and the live state of every control:

- `position` — `latlong`, `sensor_used`, **`accuracy`**, `speed`, and **two
  timestamps**: `time` (fix taken) and `time_rcvd` (server received it),
  minutes apart. Which one staleness means has to be explicit (**C14**).
- `hardware` — `battery_level`, `temperature_state`, `power_saving_zone_id`
- `led_control`, `buzzer_control`, `live_tracking` — each with `active`,
  `timeout`, `remaining`, `pending`. So control state is observable, not just
  settable.
- `tracker_state`, `charging_state`, `battery_state`

Confirmed **C12**: the channel says `accuracy` where REST says
`pos_uncertainty`. There's a test asserting both halves of that, so a silent
flip can't slip through.

We also now have our own [auth.js](auth.js) — the wrapper hides the client ID
and keeps its token on `globalThis`, neither of which the channel can use. That
leaves two auth paths, which is why **Q12** asks whether the wrapper still earns
its place.

## What the live-tracking probe told us

Live tracking turned on cleanly and stayed on — `active: true`, `remaining:
1794` counting down the 1800s device timeout. It did not self-disable at home.
`npm run live [seconds]` runs a bounded window and turns it back off afterwards.

Three findings, two of which change how we build:

**Channel events are deltas, not snapshots.** The first `tracker_status` is
complete; every one after it carries *only what changed*:

```js
{ tracker_id: '...', tracker_state: 'OPERATIONAL',
  live_tracking: { active: true, remaining: 1794, ... },
  charging_state: 'NOT_CHARGING', message: 'tracker_status' }
```

No `position`, no `hardware`. A consumer that replaces its state on each event
loses them. State has to be **merged** (**C16**, **F17**).

**Indoors, live mode produces nothing.** 55 seconds of confirmed-active live
tracking with the cat inside yielded **zero** new fixes — just the same stale
position re-sent. GPS can't see sky through a roof. Harmless for the product,
but it means every cadence and noise-floor measurement has to be taken
**outdoors**, including step 4's stationary test (**C17**).

> **Withdrawn, 2026-09-21.** This held for 55 seconds in one spot and was then
> built on as though it were general. It is not: an hour of the tracker on its
> charging dock produced **747 fresh GPS fixes, four seconds apart, indoors**.
> The measurement advice above stands; the inference drawn from it in step 2
> does not. See **C41** and "The morning it watched a charger" below.

**Repeated positions carry an identical `time`.** Deduplicate on it, or each
repeat becomes a zero-distance, zero-elapsed fix and divides by zero in the
speed calculation (**C18**).

Commands acknowledge in two stages — `pending: true`, then `active: true` with
a `started_at` (**C19**), so we can tell a command landed rather than hoping.

Still unanswered: **the real fix interval in live mode** (Q1). That needs her
outdoors.

### What movement actually looks like

A guided walk (`npm run record -- --phases`) with the tracker held in hand,
prompts delivered to a phone, each fix tagged with the pace being walked:

| pace | median m/s | max m/s |
|---|---|---|
| standing still | 0.15 | **0.23** |
| walking slowly | 0.69 | 0.78 |
| walking normally | 1.00 | 1.27 |
| jogging / bursts | 1.52 | 1.58 |

Monotonic and cleanly separated — **4.2x** between standing still and walking.
Derived speed is the usable signal; the tracker's own `speed` field is
intermittent (absent when still) and wrong when present (0.1 m/s reported
while actually doing 1.52).

**The important finding is the lag.** Reported position trails real motion by
about **8 seconds**, two fixes. Speed does not rise until two fixes after
walking begins, and the two fastest readings of the entire recording arrive two
fixes *after* the running stopped. The device is smoothing. That sets a floor on
how immediate any alert can be, and it means analysis must discard fixes near a
phase boundary or sprint speeds land in the "standing still" bucket (**C22**).

### The noise floor test (step 4) — done, and it passed

The one thing that could have killed the premise. Measured with the tracker
sitting stationary in the garden, live tracking on, 39 fixes over 2.8 minutes:

| | median | p95 | max |
|---|---|---|---|
| fix interval | **4.0s** | 5.0s | 11.0s |
| spread from true position | 0.52m | 0.75m | 1.11m |
| apparent movement per fix | 0.06m | 0.58m | **0.66m** |
| noise in derived speed | 0.01 m/s | 0.17 m/s | **0.28 m/s** |

**Sub-metre.** A walking cat is around 1 m/s and a sprinting one 3-8 m/s,
against a speed noise ceiling of 0.28 m/s — an order of magnitude of headroom.
The movement heuristics are viable, and every threshold now has a measured
floor to clear rather than a guessed one.

Two caveats worth keeping honest: this is one recording, and it is open sky.
A cat under a car or deep in a hedge is the case that matters most and is
still unmeasured (**Q14**) — watch `sensor_used` dropping away from GPS.

Also learned here: **live-mode fixes carry no `speed` field at all** (39 of 39
undefined), though the REST report does. Deriving speed ourselves is mandatory.
And `accuracy` reads `0` on every settled live fix, so it is not a usable
quality gate (**Q4**).

## Signals

Derived per position fix:

- **staleness** — time since last fix. Silence is the scariest signal.
- **speed** — our own haversine distance ÷ dt. Log Tractive's reported `speed`
  alongside it and see which is more usable.
- **thrash ratio** — path length over trailing 60s ÷ net displacement over the
  same window. High = moving hard, going nowhere = scuffle or being circled.
- **distance from home**
- **accuracy** / **sensor_used** — a drop to CELL means she's under a car or shed.

Candidates once a baseline exists: distance to the rival's known haunt as a
continuous signal, altitude delta (fence/wall/tree), time-of-day banding.

## Ground rules

1. **Update [requirements.md](requirements.md)** with every change that touches a
   requirement, constraint, or open question.
2. **Update the tests.** New capability gets end-to-end coverage; changed
   behaviour gets its assertions changed with it.
3. **This repo is public.** Nothing identifying is hardcoded — no pet name, no
   pet or tracker IDs, no coordinates or addresses. It comes from the
   environment via [config.js](config.js); only `.env.example` is committed.
   Scrub probe output before pasting it anywhere.

## The dashboard

```bash
npm start                                      # live
npm start -- --no-live                         # live, without touching the device
npm start -- --replay data/<file>.jsonl --pace 1
```

Then open `http://localhost:8080`. One process serves the page and holds the
channel; no dependencies, no build step.

Three stacked traces over five minutes — **speed**, **thrash**, **silence** —
with current values, active findings, and a calm/elevated/alarm banner.

Two things that matter more than they look:

- **Fixed scales with measured bands.** Auto-scaling is every charting
  library's default and would zoom into a calm cat's noise until it looked
  dramatic. The speed axis is pinned, with bands drawn from the walk: still
  below 0.23, walking 0.69-1.27, sprint above 2.5.
- **Gaps stay gaps.** When data stops the line breaks rather than
  interpolating across. Silence is the signal we most want to see.

`/health` reports healthy only while data is actually arriving — a monitor that
has silently stopped monitoring is the failure worth catching, and process
liveness would not catch it.

## Knowing the monitor is alive

The worst failure in this system is silent. The service dies, no alerts
arrive, and that is indistinguishable from a quiet afternoon — you would not
find out until the day it mattered.

Two guards, at different levels:

**The channel stalls quietly.** Keep-alives arrive every five seconds, but a
socket can stay open and silent indefinitely without `fetch` ever erroring. If
none arrives for sixty seconds the connection is torn down and remade. Without
this the service would look healthy while seeing nothing.

**One notification a day**, at a configurable hour, saying it is watching and
how the tracker is. If it does not arrive, something is wrong. It costs one
message a day and needs nothing outside the system to run it.

```
Watching Topina
tracker on charge · battery 100%
```

A fixed hour rather than every-24-hours on purpose: its absence should be
noticeable at a time you are awake, not drifting into the night.

## Incidents

A finding belongs to one reading and vanishes with it. That is fine for
deciding whether to buzz a phone and useless afterwards — you cannot review a
finding, cannot say "that one was real", and cannot tune thresholds against
four hundred thousand fixes.

So an incident opens when something confirms, stretches while anything stays
active, and closes after two quiet minutes, keeping what it peaked at and
whether it happened in the rival's garden. They survive a restart, so a crash
mid-incident does not lose the thing worth looking at.

The dashboard lists them with two buttons: **real** and **nothing**. That is
the whole labelling interface, deliberately — the analysis happens outside,
with the exported data, and a workbench built into the dashboard would be a lot
of work for a tool with one user.

Labels are what eventually turn the thresholds from provisional into measured.
Right now nine sprint events a week fire and nobody knows whether any was
danger.

## Export

Pick a window, download `.jsonl`, hand it to Claude and look at it together.

**Everything is in one store.** Every fix is written with its position, its
derived signals, the verdict, the phase, the zone and the battery — alongside
the phase changes, holds, notifications and zone crossings. An export that held
only the decisions and not the evidence would be the wrong half of the picture.

```json
{"time":1789921736,"latlong":[57.76,12.06],"accuracy":0,"sensor":"GPS",
 "speed":null,"thrash":null,"fromHome":12.9,"zone":null,
 "level":"calm","findings":[],"phase":"off-hours","battery":100}
```

Raw fixes are pruned after `retentionDays` (30 by default). Incidents are never
pruned — they are scarce and they are the part worth keeping.

```bash
curl 'localhost:8080/export?from=<ms>&to=<ms>' -o window.jsonl
```

The dashboard has a date-range picker with "last hour" and "today" shortcuts.

## Notifications

Away from home the notification and the Tractive app are the whole experience,
so the body stands alone and a tap opens Tractive on her live map — they built
a map, we should not build another.

No coordinates: a latitude and longitude tell you nothing at a glance, and a
distance from home does. It also keeps them out of the notification shade of a
phone that might be handed around or screenshotted.

```
[INFO ] Topina is out
        live tracking on · 62m from home
[ALARM] Can't see Topina
        no fixes arriving — last seen · 62m from home
[ALARM] Topina bolted in the danger zone
        4.20 m/s · 62m from home
[ALARM] Topina's tracker is at 20%
        charge it soon, tracking will stop
```

Three tiers. `info` for going out and coming back, `warn` for elevated findings
and battery steps, `alarm` for anything urgent — only the last arrives at
Android high priority. If "she is out" landed with the same weight as "sprint
in the enemy's garden" you would learn to ignore both, and an ignored alert
costs the same attention as a useful one while buying nothing.

The coordinates are in the body deliberately. Tapping through shows where she
is *now*, which for "went quiet four minutes ago" is not what the alert was
about.

## Detectors

| finding | level | threshold | basis |
|---|---|---|---|
| `sprint` | alarm | 3.0 m/s | **her own data**: p99 1.49, max 9.38 |
| `thrash` | alarm | ratio 4, while moving | measured: 1.3 walking a line, 5.7-8.8 confined |
| `silence` | alarm | 90s | provisional — ~20 missed fixes |
| `no-gps` | elevated | sensor ≠ GPS | under a car or shed |
| `far-from-home` | elevated | 80m | **her own data**: p99 62m, max 142m |

A condition must hold for two consecutive readings before it escalates, so one
noisy fix cannot raise an alarm. Clearing is immediate — being slow to notice
trouble is worse than being quick to relax.

Replayed against the measured walk, the detectors read **calm** through
standing still and both walking paces, and **alarm** through every fast-burst
reading. That is the whole of the tuning evidence so far: no cat in trouble has
ever been recorded, so every threshold is provisional.

## Watching the signals

```bash
npm run watch                                    # live, live tracking on
npm run watch -- --no-live                       # live, without touching the device
npm run watch -- --replay data/<file>.jsonl      # replay a recording
npm run watch -- --replay data/<file>.jsonl --pace 1   # ...in real time
```

```
  speed   moved  intvl  thrash   home   acc  sensor  phase
   0.69     2.7      4       -     41     0     GPS   2-walk
   1.00     4.0      4     1.8     52     0     GPS   3-walk
   1.58     6.3      4     5.7     38     0     GPS   4-fast
```

Replay runs the recording through **exactly the same code** as a live
connection — same merging, same dedupe, same signals — because both sources
yield `{ receivedMs, event }` and the clock is injected rather than read.
Detectors can therefore be tuned against the corpus without needing a cat,
weather and an incident to coincide.

That paid for itself immediately. Replaying the measured walk showed the thrash
ratio reading **2.4-3.4 while standing still** and only **1.3-1.6 while
walking** — inverted, because a stationary tracker's jitter accumulates path
length while going nowhere and so scores like a scuffle. It is now gated on
average speed clearing 0.4 m/s, which sits in the measured gap between standing
(0.23) and walking slowly (0.69). Gated, it reads nothing when still, ~1.3
walking in a line, and 5.7-8.8 while jogging around a confined space — which is
the shape a real scuffle should have.

Staleness runs on its own timer rather than off the event stream, since the
thing it measures is the *absence* of events: nothing arriving means nothing
would otherwise recalculate.

## Knowing the monitor is alive

The worst failure in this system is silent. The service dies, no alerts
arrive, and that is indistinguishable from a quiet afternoon — you would not
find out until the day it mattered.

Two guards, at different levels:

**The channel stalls quietly.** Keep-alives arrive every five seconds, but a
socket can stay open and silent indefinitely without `fetch` ever erroring. If
none arrives for sixty seconds the connection is torn down and remade. Without
this the service would look healthy while seeing nothing.

**One notification a day**, at a configurable hour, saying it is watching and
how the tracker is. If it does not arrive, something is wrong. It costs one
message a day and needs nothing outside the system to run it.

```
Watching Topina
tracker on charge · battery 100%
```

A fixed hour rather than every-24-hours on purpose: its absence should be
noticeable at a time you are awake, not drifting into the night.

## Incidents

A finding belongs to one reading and vanishes with it. That is fine for
deciding whether to buzz a phone and useless afterwards — you cannot review a
finding, cannot say "that one was real", and cannot tune thresholds against
four hundred thousand fixes.

So an incident opens when something confirms, stretches while anything stays
active, and closes after two quiet minutes, keeping what it peaked at and
whether it happened in the rival's garden. They survive a restart, so a crash
mid-incident does not lose the thing worth looking at.

The dashboard lists them with two buttons: **real** and **nothing**. That is
the whole labelling interface, deliberately — the analysis happens outside,
with the exported data, and a workbench built into the dashboard would be a lot
of work for a tool with one user.

Labels are what eventually turn the thresholds from provisional into measured.
Right now nine sprint events a week fire and nobody knows whether any was
danger.

## Export

Pick a window, download `.jsonl`, hand it to Claude and look at it together.

**Everything is in one store.** Every fix is written with its position, its
derived signals, the verdict, the phase, the zone and the battery — alongside
the phase changes, holds, notifications and zone crossings. An export that held
only the decisions and not the evidence would be the wrong half of the picture.

```json
{"time":1789921736,"latlong":[57.76,12.06],"accuracy":0,"sensor":"GPS",
 "speed":null,"thrash":null,"fromHome":12.9,"zone":null,
 "level":"calm","findings":[],"phase":"off-hours","battery":100}
```

Raw fixes are pruned after `retentionDays` (30 by default). Incidents are never
pruned — they are scarce and they are the part worth keeping.

```bash
curl 'localhost:8080/export?from=<ms>&to=<ms>' -o window.jsonl
```

The dashboard has a date-range picker with "last hour" and "today" shortcuts.

## Notifications

An Android app in [app/](app/) receives pushes over FCM. It is a receiver and
nothing else: the service decides what is worth knowing, the app only makes
sure the phone buzzes. It shows its FCM device token to be copied into the
service's `.env`, and keeps a log of what arrived so a missed alert can be
checked against what was sent.

There is no communication back to the service. For one phone and one cat,
pasting a token once is simpler and more robust than device registration,
discovery, and a server the handset can reach.

```bash
cd app && flutter build apk --release
adb install app/build/app/outputs/flutter-apk/app-release.apk
npm run notify:test      # prove the chain works without waiting for trouble
```

Sending uses no SDK — one RS256-signed JWT exchanged for an access token, then
one POST — so the project stays at zero runtime dependencies. Alerts fire when
a finding **appears** and then go quiet for five minutes even if it keeps
firing: detectors run every four seconds, and a dozen buzzes per incident
trains you to ignore the phone. An ignored alert is worse than none, since it
costs the same attention and buys nothing.

Needs `FCM_TOKEN` (from the app) and a service-account key at
`.fcm-service-account.json`. Both gitignored; in production the key is a
Kubernetes Secret (**D3**).

## Knowing when she is out

```
on the dock             → she is indoors. no command sent, no fix judged.
outside 07:00-17:00     → nothing. she is never out at night.
otherwise, every 3 min  → live on for 30s. a fresh fix suggests she is outside.
while out               → live stays on, re-armed as the device drops it.
30 min going nowhere    → near home, that was not an outing. retract it.
fixes stop near home    → she came in.
fixes stop far from home→ signal lost. stay live, say so.
```

**There is no positive test for "she is outside", and this originally shipped
believing there was.** A fresh fix during a sample was taken as proof, on the
strength of 55 seconds of indoor live tracking that produced none. An hour of
the tracker sitting on its charger produced 747 of them (see below), and the
service called it an outing.

Nothing positional replaces it. Measured against a week of her own fixes, a
resting cat in the garden and a docked tracker are indistinguishable: her
median centre displacement over a minute is 2.7m against the charger's 1.2m,
the charger's scatter is *tighter* than hers, and 59% of her entire week falls
within 10m of where the charger sits — the garden is 12m from the house and her
whole territory is about 60m across.

So the system rules outings *out* rather than in. Two mechanisms do that work:

**The docked latch.** `charging_state` is not the question; "is it on the dock"
is. The charger stops charging at 100% and reverts to `NOT_CHARGING`, so the
old check went blind exactly when the tracker had been docked longest. The
latch closes on the first sight of charging and opens only on proof of movement
— 20m inside a minute, or 15m across half an hour. While it is closed, no fix
is judged at all: the detectors never see a tracker that is not on her.

**Retraction on stillness.** An outing used to end only on silence, so a
stationary tracker emitting fixes stayed "out" indefinitely. Half an hour whose
median centre moves less than 7m, within the home radius, now ends it and says
so. Deliberately limited to near home: out in the field, stillness is at least
as likely to mean something has gone wrong as to mean she is not there.

Distance from home earns its place in exactly one job: when fixes stop, telling
a homecoming from a lost signal. It cannot separate the house from the garden
(8m indoors versus 2m in the garden), so it is used for nothing else.

### The morning it watched a charger

2026-09-21, 07:00 to 08:00. The tracker never left its dock. What the service
did with that hour, and what each part of it cost:

| | |
|---|---|
| 07:00:00 | window opens, `off-hours → sampling` |
| 07:00:10 | fresh fix → **"she is out"**, live tracking pinned on |
| 07:16:42 | manual hold, live off — someone can see she is indoors |
| 07:21:25 | hold cleared, and **10 seconds later it declared the same outing again** |
| 08:12 | still `out`, still live, battery 100% → 96% on the charger |

747 fixes, 530 distinct positions, **390m of accumulated path**, wander to 62m
from home, one single-fix jump of 49.5m, and three alarms — an 11.54 m/s
"sprint" whose centre moved 4.2m, and two thrash findings. Every number in that
sentence came from a device sitting still.

The hour is committed as `tests/fixtures/docked-hour.jsonl` and replayed by
`tests/unit/docked-hour.test.js`. It is the only known-bad case this project
has; it cannot be regenerated, and the tests that stop this recurring are
worthless without it.

Three things it taught, beyond the fix itself:

- **Path length lies and displacement does not** — but only computed robustly.
  Endpoint-to-endpoint displacement peaked at 52m on this hour, off that one
  outlier. Comparing the median of each half of the window instead never
  exceeded 6.5m (**C41**).
- **Thrash must not be gated on displacement.** A fight is two cats going
  nowhere hard. Suppressing findings that go nowhere would blind the detector
  to the thing this project exists for, so the tracker is kept away from the
  detectors instead of the detectors being weakened.
- **The `sprint: 3.0` threshold is now looser than it was measured to be.** It
  was swept against nine sprints a week in her history; gating on displacement
  leaves three of those standing, so most of what it was tuned against was bad
  fixes. Due a re-sweep.

And one that is about the system rather than the cat: **turning live off while
the service insists she is out is a correction, and it used to be discarded.**
It is now recorded as a `false-positive` event with the evidence as it stood,
because it is the only ground truth this project gets about its own false
positives — a week of her movement contains no known-bad case, and this is how
that corpus starts.

Re-arming needs no special path: every tick asks for live, the snapshot says
whether it is on, and a lapse is simply asked for again.

## Controls

The dashboard carries a live-tracking panel and a settings table. Every
threshold, interval and detector is editable there, and each row shows where
its value came from — `default`, `env` or `dashboard` — so a setting that
ignores its environment variable explains itself.

Each detector has its own on/off switch. Silencing one should be a deliberate,
visible act rather than shoving its threshold out of reach, where the reason
gets lost.

The manual hold shows what it is holding and **how long is left** —
`held OFF — reverts to auto in 12 min`. A hold that expires silently is
confusing: you turned something off for a reason and twenty minutes later it is
back on with no explanation.

## Settings and state

SQLite on disk via `node:sqlite`, so still no dependencies. Settings are seeded
once from defaults and the environment; after that the **stored value wins**,
following the pattern already used by `showgrab`. Because that surprises people
later — editing an environment variable then does nothing — every setting
records where its value came from, so the dashboard can say so.

```bash
curl localhost:8080/settings                                   # values and sources
curl -X POST 'localhost:8080/settings?key=sampleIntervalS&value=120'
curl 'localhost:8080/events?from=<ms>&to=<ms>'                 # export a window
```

The outing state and any manual hold are stored too. A service restarted
mid-outing comes back still knowing she is outside — without that it would
quietly stop watching her and say nothing.

Every number the docked latch and the stillness retraction depend on is a
setting, including the two **window lengths**, which are the ones that change
behaviour most:

| setting | default | what moving it does |
|---|---|---|
| `stillnessWindowS` | 1800 | Both the basis of "not out after all" and the patience before saying so. Shorter reacts faster and risks writing off a long sit |
| `reactionWindowS` | 60 | How quickly the tracker leaving its charger is noticed. Shorter is faster but noisier |
| `departureM` | 15 | Movement over the long window that opens the latch |
| `reactionDepartureM` | 20 | The same over the short one. Higher, because a minute is a noisier basis than thirty |
| `stillM` | 7 | Movement over the long window below which this was not an outing |
| `stillnessRetractEnabled` | true | Off restores the old behaviour, where only silence could end an outing |
| `gateDisplacementM` | 7 | Ground she must have covered for a sprint to be believed |
| `displacementGateEnabled` | true | Off lets a single bad fix raise a sprint again |

Both windows resize under a running service — the tick applies the configured
span before reading it, so an edit takes effect on the next reading rather
than at the next restart. Shortening one drops the history that no longer fits
immediately, because a tracker that has gone quiet might not send another fix
for minutes and a stale answer over the old span is the one thing a shortened
window must not give.

Two numbers are deliberately **not** settings. `MIN_FIXES` is six because the
median of each half is what makes displacement robust to a wild fix, and a
half of fewer than three has no median worth the name — it is the floor the
method imposes, not a preference. `WINDOW_S` in `signals.js` stays fixed
because the thrash ratio is derived from it, and moving a detector as a side
effect of changing an outing setting is how you get a surprise a month later.

### Shutting down

`SIGTERM` stops the service and turns live tracking off. That matters because
Kubernetes stops a pod with SIGTERM on every restart, and getting it wrong
leaves the tracker draining.

Three separate bugs had to be fixed for this to work at all: the handler
referenced a variable that no longer existed and threw on its first line;
`fetch` has no timeout, so turning live off could hang forever; and the
handlers were registered *after* a top-level `for await` loop that never
returns, so they were never registered at all.

## Deployment

Manifests in [deploy/](deploy/) — a kustomize base for K3s, following the same
pattern as the other apps on the home server. Image published to GHCR on
release; Argo CD Image Updater picks up new semver tags.

The load-bearing detail is the `/config` volume holding the token cache.
Without it, every pod restart is a real login — and since the auth endpoint
locks out for tens of minutes, a crash-loop would lock the account out of the
API entirely, taking the monitor down in a way a restart cannot fix.

See [deploy/README.md](deploy/README.md) for the two secrets and why the
liveness probe is deliberately slack.

## What is normal for her

`npm run territory [days]` pulls her position history and reports where she
actually goes. Run against a week — 6,403 positions — it replaced two invented
thresholds with measured ones:

| | |
|---|---|
| distance from home | p50 **14m** · p95 47m · p99 62m · max **142m** |
| her own speed | p50 0.19 m/s · p99 1.49 · p99.9 3.89 · max **9.38** |
| sensor | 100% GPS, not one cell or wifi fallback |
| when she is out | 08:00, 12:00-13:00, 16:00 — effectively never 19:00-07:00 |

Two corrections fell out of that:

- **`far-from-home` at 150m was dead code.** She has never been that far. Her
  range has a hard edge — 60m catches 89 fixes, 70m catches 5 — so her world
  ends around 65m. Now 80m.
- **`sprint` at 2.5 m/s would have fired sixteen times a week.** Swept by
  distinct events per week: 2.0→19, 2.5→16, 3.0→9, 3.5→6, 4.0→5, 5.0→2. Now
  3.0, erring toward noticing. Whether any of those nine was real danger is
  still unknown.

## Authentication

Log in once, keep the token, log in again only when it runs out. Tokens last
about two months and there is no refresh token.

This is not an optimisation. **The auth endpoint rate-limits hard** — a handful
of logins returns HTTP 429 with no `Retry-After`, and the lockout outlasts ten
minutes, taking the whole API with it. A process that logs in on every run will
lock the account out. Learned the hard way.

`session()` in [auth.js](auth.js) handles it: reads `.token.json`, renews only
within an hour of expiry, and if renewal is refused while the current token is
still valid, carries on with the current token. Use `session()`, never
`authenticate()` — the latter is the real login and should be rare.

`.token.json` holds a bearer token: gitignored, written 0600.

**If you do get locked out**, the lockout is on the auth endpoint alone —
existing tokens keep working, and one from elsewhere works immediately. Open
my.tractive.com, DevTools → Network, copy any request's `Authorization: Bearer`
value, then:

```bash
npm run token -- <the-token>
```

It verifies the token against a real endpoint before installing it, so a
mistyped paste fails there rather than three steps later. This is also the way
to bootstrap without ever calling auth.

## Recording and analysis

```bash
npm run record 180        # live tracking on, record 3 min, live tracking off
npm run record 180 -- --no-live    # record without touching the device
node analyse.js data/<recording>.jsonl
```

Recordings land in `data/` as one JSON object per line, raw and unfiltered.
They are gitignored — they contain coordinates (**G3**) — and they are the
corpus the detector thresholds get tuned against.

`analyse.js` reports fix cadence, the spread of a stationary tracker, apparent
movement, derived speed, and accuracy. It drops the warm-up fixes — the stale
cached report and the catch-up jump that arrive before the cadence settles —
since their distance would swamp the noise floor being measured.

## Setup

Requires Node 18+ (we're on 23).

```bash
npm install
cp .env.example .env    # fill in email + password
npm run probe           # step 1 — prints your pet and tracker IDs
# put those IDs and a PET_NAME into .env
npm run position        # step 2
npm test                # end-to-end suite
```

**Auth note:** the API only accepts `grant_type=tractive` with email + password —
no Google or Apple sign-in. If the account was created with Google SSO, use the
website's forgot-password flow to set a password. Google sign-in keeps working in
the official app afterwards.

## Decisions

- **Live tracking is always on.** Settled. There's a better idea for managing this
  coming later; until then, assume always-on.
- **No session replay.** Don't care.
- **Notifications deferred.** Web dashboard first, just to see whether any of this
  works at all.
- **Don't rebuild the official app.** The map is context, not the main event.

See [requirements.md](requirements.md) for the full requirement set.
