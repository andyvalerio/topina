# Deploying to the home server

The manifests do **not** live here. They live in the private
[home-server](https://github.com/andyvalerio/home-server) repo, which is what
ArgoCD actually syncs from, alongside every other service on the Beelink:

| What | Where |
| --- | --- |
| Base manifests | `apps/topina/` |
| Prod overlay (hostPath PV) | `overlays/prod/topina/` |
| ArgoCD Application | `argocd/apps/prod/topina.yaml` |
| Image auto-update | `apps/argocd-image-updater/imageupdater-topina.yaml` |
| Deployment requirements | `docs/requirements/services.md` (REQ-SVC-009) |

Keeping a second copy in this repo would mean two sources of truth that drift.
This file records the reasoning that belongs to the app rather than to the
cluster; the cluster-shaped detail is in REQ-SVC-009.

Shipping a new version is one step: publish a GitHub release. CI builds the
image to `ghcr.io/andyvalerio/topina`, and ArgoCD Image Updater picks up the
new semver tag on its own.

## Secrets

Nothing identifying is in git (**G3**), and that rule does not stop at this
repo's boundary — so both secrets are created by hand on the cluster. They are
the only manual step.

```bash
kubectl create namespace topina

# Everything the service reads from the environment. Piped from .env via
# stdin rather than passed as --from-literal, so no value lands in argv or
# shell history.
kubectl -n topina create secret generic topina-secrets --from-env-file=/dev/stdin < .env

# The FCM service-account key, from the Firebase console:
# Project settings → Service accounts → Generate new private key.
kubectl -n topina create secret generic topina-fcm \
  --from-file=key.json=/path/to/.fcm-service-account.json
```

## Why the dashboard is on port 8100

`coredns` already binds `*:8080` on the node. A LoadBalancer on 8080 would
leave klipper-lb contending with cluster DNS for the host port — topina would
never get an external IP, and cluster DNS is not worth disturbing. The
container still listens on 8080 inside the pod, where nothing collides.

## The clock

The deployment must set `TZ` (`Europe/Stockholm`). Every schedule here is in
local-clock hours and a container has none — `node:22-slim` is UTC, so an
unset `TZ` runs the 07:00-17:00 window at 09:00-19:00 local in summer without
erroring or looking wrong (**C39**). An IANA zone, not an offset, so October's
switch to CET is handled.

## Where the data lives

`/home/andy/dev/topina/config` on the NVMe root disk, mounted at `/config`.

Every other service on this machine stores its data on `{DRIVE}`
(`/media/expansion`), but that disk is at 97%. topina's own footprint is
trivial — tens of MB a year — but the token cache sharing that volume is
load-bearing, so it sits on the disk with room to spare. The path is pinned
explicitly rather than letting `local-path` auto-provision an opaque
`pvc-<uuid>` directory that nobody could find later.

The PV is `Retain`, not `Delete`: see below.

## Seeding the token cache

Worth doing, and easy to overlook. Tractive's auth endpoint locks out for tens
of minutes after a handful of logins, so a first start that cannot log in —
or a crash-loop — can lock the account out of the API entirely (**C20**,
**D1**). Copying a working token into the volume means the first start needs
no login at all:

```bash
kubectl -n topina cp .token.json <pod>:/config/token.json
```

If the volume is empty the service logs in once and caches it there, which is
fine; this just removes the one moment where that could go wrong.

## Why the liveness probe is so slack

`/health` reports healthy only while data is actually arriving, because a
monitor that has silently stopped monitoring is the failure worth catching and
process liveness would not catch it (**D5**).

But she is indoors most of the day, and indoors produces no fixes at all
(**C17**) — so `failureThreshold` is 30 with a 60s period. A tighter threshold
would restart the pod all afternoon for no reason, which is the opposite of
what the probe is for.

## What is deliberately not here

- **No ingress.** Reachability from outside the LAN is handled by Tailscale
  instead: `tailscale serve --bg --tcp 8100 tcp://localhost:8100` on the node
  publishes the dashboard to the tailnet, the same way the other services
  there are reached. Tailnet-only — **Funnel is deliberately off**, so the
  page is never on the public internet. It still has no authentication and
  still shows her live location, so the tailnet boundary is the only thing
  protecting it (**N3**, **D8**). No certificate, no router port-forward.
- **No recording volume.** `RECORD_DIR` is unset, so the service keeps no raw
  log in production (**D7**). Recordings are made deliberately with
  `npm run record`. Setting it without a volume behind it would fill the
  container's writable layer and lose the data on restart anyway.
