# DaylightBrowser

DaylightBrowser is an independently deployed browser extension under
`_extensions/daylight-browser`. Its shared browser pool and exact operation
registry are provider-neutral. Libby supplies the first typed operation;
future providers need separate schemas, policies, backend ports, gateways,
and tests. There is no generic navigate, evaluate, fetch, or proxy API.

## Deployment and configuration

Libby composition is opt-in. In the selected household folder, create
`media/libby.yml` (the default household path is
`data/household/media/libby.yml`) with:

```yaml
enabled: true
credential_owner: <username>
```

The credential owner must be one ordinary user-directory segment; `.`, `..`,
path separators, booleans, and numbers are rejected. The token remains at
`data/users/{username}/auth/libby.yml` and is never mounted into this sidecar.

Build the pinned Playwright image and package together: both currently use
`1.63.0`, with the `v1.63.0-noble` official image. Validate the supplied compose
configuration before deployment:

```sh
npm test --prefix _extensions/daylight-browser
docker compose -f _extensions/daylight-browser/docker-compose.yaml config --quiet
docker compose -f _extensions/daylight-browser/docker-compose.yaml build
```

Production wiring is checked in at `docker/daylight-browser.compose.yaml`. It
is an overlay for the authoritative backend Compose service name
`daylightstation` documented in `docs/runbooks/docker-compose-production.md`.
Build the reviewed sidecar from the repository root, then merge the image-only
overlay with the environment's base Compose file. Keeping the overlay
image-only prevents Compose from resolving its build context relative to an
external base file. The overlay durably joins
both services to `daylight-private` and injects
`DAYLIGHT_BROWSER_URL=http://daylight-browser:3000` into the backend:

```sh
docker build -t daylight-browser:1.63.0 _extensions/daylight-browser
docker compose -f '<production-base-compose.yml>' \
  -f docker/daylight-browser.compose.yaml config --quiet
docker compose -f '<production-base-compose.yml>' \
  -f docker/daylight-browser.compose.yaml up -d
```

The base file must define `services.daylightstation`; a different local name
must be normalized in that base file rather than silently editing the overlay.
The authoritative base shape uses its Compose `default` network; the overlay
lists both `default` and `daylight-private` so adding the sidecar does not
replace that existing attachment. A deployment whose base renamed `default`
must normalize that existing network as `default` in its base file before
merging this overlay. Preserve all other services.
The composition factory's `browserBaseUrl` argument overrides this environment
setting. The gateway accepts only the fixed service hostname, localhost, or
private/loopback IP literals; arbitrary private DNS names are not accepted.

Publish no sidecar host port. Mount no Daylight data or credential files and
pass no account credentials in its environment. Preserve `pwuser`, read-only
root, tmpfs storage, dropped capabilities, no-new-privileges, init, and resource
limits. Chromium needs outbound HTTPS, so this bridge is not Docker
`internal: true`. Browser interception enforces provider destinations; a
deployment firewall/proxy may additionally constrain egress. Bridge isolation
alone does not constrain outbound destinations after a container compromise.

Deploy or update only within the environment's authorized deployment workflow.
The standalone extension compose file does not attach or restart an existing
backend; use the production overlay for durable stack deployment.
Consult `.claude/settings.local.json` and `CLAUDE.local.md` for actual hosts,
paths, stack names, and deployment authority.

## Health and failure handling

`GET /health` returns `{ "status": "ok" }`; the compose healthcheck uses the
container loopback interface. This checks HTTP liveness, not an authenticated
provider operation. Inspect only categorical `browser.operation` outcomes and
HTTP status. Never turn on request-body, browser-console, network-trace,
cookie, or raw provider-error logging.

| Condition | Behavior / response |
| --- | --- |
| Invalid schema or origin | Rejected before browser work, HTTP 400. |
| Unknown operation | HTTP 404. |
| An operation already owns the browser slot | HTTP 409; no overlapping context. |
| Unsupported or malformed spine | HTTP 422; no DRM bypass or fallback inference. |
| Browser failure, disconnect, poisoned pool | Categorical failure, HTTP 502 when connected. |
| Bootstrap deadline | HTTP 504; context cleanup runs. |
| Gateway timeout, outage, invalid reply | Backend fails closed; no public provider capabilities. |

The pool runs one operation at a time, with a fresh nonpersistent context per
operation. Unresolved acquisition or hung cleanup poisons the pool to prevent
overlap; restart the sidecar through the normal operational workflow to recover.
Investigate recurring categorical failures before retrying. A healthy HTTP
endpoint alone cannot prove the pool or provider contract is ready.

## Security boundary and provider updates

The backend retains the account credential and verifies the exact active loan.
The sidecar receives only the one-use web URL/message and generated operation
ID. Its response contains descriptive metadata, ordered MP3 capability URLs,
and empty media headers; these go directly into process-local leases, never
queue/API responses. Cookie-backed browser media capabilities are unsupported.

The Libby operation allows the exact shell navigation and same-origin
possession request. Only three observed official static paths at the pinned
bundle version are eligible, with one private static origin bound per operation.
After validating the complete declared spine, the operation clicks the official
Play control once and permits only the exact shell media flow and playback on
the exact HTTPS `audioclips.cdn.overdrive.com` host. The context route stays
installed. After original-page CDP Fetch interception is enabled, the route
atomically flips from bootstrap rules to media rules. Only original-page/main-
frame GET Media requests to the exact shell/CDN origins continue; popup/extra-
page initial navigation, routable worker traffic, navigation, foreign, malformed, non-GET, and
non-media requests abort pre-egress. CDP gates every original-page redirect hop
and records each CDN capability while paused. Before provider navigation, the
policy makes `Worker` and `SharedWorker` non-configurable throwing constructors
in every page/frame realm. This closes Blob-backed shared-worker targets outside
context routing and page CDP; service workers remain blocked by the fresh-
context configuration. The same init script makes the shared AudioWorklet
getter non-configurable and its `addModule` unavailable, blocking direct and
Blob-import module loading without disabling normal HTML audio. It seals the
same module-loading boundary on every exposed paint/layout/animation worklet
surface while preserving ordinary CSS and layout APIs. After the first
exact CDN capability arrives, normal
Chromium buffering is observed for one fixed
20-second window; arrivals do not shorten or restart it. A hard 30-second
capture deadline returns an already collected nonempty set, but remains a
categorical timeout when nothing arrived. Media bodies remain inside that
ephemeral context and are never inspected, returned, or persisted. Resource use
is bounded by the fixed window/deadline plus the compose CPU, memory, shm, and
tmpfs limits. Cleanup flips the context route to block-all, and the media page
closes while CDP interception remains active. Only
after confirmed closure is interception disabled/detached and the independent
range probes started. If target closure fails, interception stays installed
while the pool closes or poisons the context/browser; the live target is never
released into an unenforced gap.

Each distinct signed capability observed during that window is independently
checked with a credential-free `bytes=0-0` request whose body is canceled
unread. Its response-declared total length must uniquely match a declared BIF
part length. Arrival order is not trusted: unique matches are sorted by their
original declared spine index and must form one contiguous window with no gaps.
The window may begin after index zero when the official player resumes its saved
position. Returned transport indexes are normalized to zero-based array order;
stable keys, titles, durations, and lengths remain those of the original spine.
Missing, ambiguous, duplicate, noncontiguous, foreign,
non-MP3, or malformed range responses fail closed. Only this nonempty observed
window is returned, with empty headers; cookies, authorization, header values,
and browser storage are neither inspected nor replayed. Other redirects,
arbitrary scripts, foreign media, analytics, activity/reporting, popups,
downloads, service workers, and WebSockets remain blocked. Contexts and
capabilities are neither reused across operations nor persisted.

Caller disconnect and the pool deadline feed an operation-owned abort signal
used by capability probes. The single slot remains owned until the operation
settles and its context closes within the cleanup bound. If work ignores abort,
the pool is poisoned and rejects later operations rather than overlap external
work; restart the sidecar through the normal workflow.

This is intentionally an **initial playback window at the official player's
current saved position**, not full-book resolution. The official player currently
prebuffers a small contiguous window, but earlier parts and later-part
continuation are not guaranteed. A successful health check or live
probe therefore proves immediate playback only; it must not be represented as
complete-book availability.

For a provider or Playwright update, capture only authorized sanitized evidence,
add a failing regression for the changed contract, and review any policy change.
Do not widen host/path rules merely to make a timeout disappear. Keep image and
npm versions aligned, update the lockfile, rebuild, run focused and full backend
gates plus extension tests, and repeat isolated live verification before rollout.

## Opt-in live verification

Run the harness from the repository root in a backend-capable environment with
existing dependencies. Start only an isolated sidecar if needed; this probe
does not start an HTTP backend or dispatch playback to a device. All six values
below must be explicitly provided. The credential remains in the backend's
`data/users/{username}/auth/libby.yml`; never copy it into the sidecar.

```sh
LIBBY_LIVE=1 \
LIBBY_LIVE_DATA_PATH='<backend-data-root>' \
LIBBY_LIVE_USERNAME='<username>' \
LIBBY_LIVE_CARD_ID='<active-card-id>' \
LIBBY_LIVE_TITLE_ID='<active-title-id>' \
DAYLIGHT_BROWSER_URL='http://daylight-browser:3000' \
node _extensions/daylight-browser/test/live/libby-bootstrap.live.mjs
```

The probe uses the real composition/client/gateway chain, issues an in-memory
lease, requests `bytes=0-0` through the existing stream use case, and opens the
cover through the cover use case. It requires MP3 parts, an exact one-byte 206
response with matching range/length headers, and an image cover MIME. It cancels
both media bodies immediately without reading bytes, calls stream cleanup, and
disposes the lease registry. The sidecar owns destruction of its browser context.
This tests the proxy application path; deployed HTTP-route and device acceptance
remain separate deployment checks.

Only `{ success, title, partCount, duration, mimeTypes, coverMimeType }` is printed.
Exit zero means all checks passed. Missing opt-in/configuration or any failure
produces `success: false`, empty aggregate values, and exit one, without provider
errors or partial capabilities. Do not dump raw responses when it fails. For a
remote isolated probe, a private transport may forward only the gateway's
three-field operation request; keep provider credentials and other HTTP calls
in the backend process. Stop/remove the temporary container and temporary image
tag afterward; never restart the production stack as part of this probe.
