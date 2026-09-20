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

| # | Step | Done when | What it could kill |
|---|---|---|---|
| ✅ 1 | Auth + identify | Token comes back; the tracker ID prints | Creds/API don't work → nothing else matters |
| ✅ 2 | One-shot position | A real lat/long prints | REST works but data's useless/stale |
| ✅ 3 | Channel connect | Raw NDJSON lines stream to stdout | No push feed → fall back to polling |
| ✅ 4 | Log to file | Events land in `.jsonl`; stationary noise-floor test done | Noise floor too high → movement heuristics dead |
| 5 | Derived signals in terminal | speed / thrash / staleness printing live | Signals too noisy to read |
| 6 | Strip-chart dashboard | Browser shows live traces | — |
| 7 | Thresholds from observed data | Detectors fire on real incidents | — |
| 8 | Notifications + deploy to Beelink | Phone buzzes | — |

Steps 1-3 are one evening. Everything past 4 depends on what the data looks like.

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

**Repeated positions carry an identical `time`.** Deduplicate on it, or each
repeat becomes a zero-distance, zero-elapsed fix and divides by zero in the
speed calculation (**C18**).

Commands acknowledge in two stages — `pending: true`, then `active: true` with
a `started_at` (**C19**), so we can tell a command landed rather than hoping.

Still unanswered: **the real fix interval in live mode** (Q1). That needs her
outdoors.

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
