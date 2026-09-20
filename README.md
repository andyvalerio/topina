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
| 3 | Channel connect | Raw NDJSON lines stream to stdout for 5 min | No push feed → fall back to polling |
| 4 | Log to file | Events land in `.jsonl`; stationary noise-floor test done | Noise floor too high → movement heuristics dead |
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

### The noise floor test (step 4)

The one thing that could kill the whole premise. If a stationary tracker jitters
±10m, the derived speed of a *sleeping* cat is ~2 m/s and every movement-based
detector is dead on arrival. Leave the tracker on a table for 10 minutes, log
every event, look at the spread. Do this before building any detector.

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
