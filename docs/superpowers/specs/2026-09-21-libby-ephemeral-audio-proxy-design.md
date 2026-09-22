# Libby Ephemeral Audio Proxy Design

DaylightStation accepts explicit Libby open-link identities such as
`libby:loan/<card-id>/<title-id>` and presents active audiobook loans through the
existing web AudioPlayer. The integration is personal and opt-in: an external
process maintains `data/users/{username}/auth/libby.yml` with a `token` field.

The Libby adapter verifies the open-link pair against `chip/sync`, opens only
active audiobook loans, reads the OverDrive Listen `openbook` spine, and maps
each MP3 part to a durable child content ID. Opening an audiobook includes the
matched loan's `websiteId` as the provider's `website_id` query parameter. The
value comes from the synchronized loan record; it is not another credential
and is not configured in `libby.yml`. The long Libby web-app `t` parameter is
not required.

The adapter returns the book title, subtitle, author, narrator, total duration,
and ordered multipart entries. Each part receives a Daylight stream lease URL.
JWTs, provider cookies, signed CDN URLs, and audio bytes remain in memory and
are never logged or persisted.

Stream leases are random, stored by hash, scoped to one part, and bounded by
loan, idle, and absolute expiry. The stream controller supports HEAD, full GET,
and one byte range with backpressure and disconnect cancellation. It refreshes
provider state once on a pre-body authorization failure and otherwise fails
closed. Provider API and redirect origins are closed allowlists.

## DDD boundaries

This integration uses the existing `content` bounded context and published
content-item/queue shapes. It does not introduce a Libby domain or make the
`media` and `playback-hub` feature domains depend on one another.

- `1_adapters/content/media/libby` is the anti-corruption layer. It owns Libby
  vocabulary, HTTP protocol details, credential-file I/O, provider-response
  translation, origin validation, and the in-memory lease implementation.
- `3_applications` owns the stream and cover use cases plus their required port
  contracts. Those use cases depend only on injected capabilities; they do not
  import adapter, API, configuration, or Node I/O implementations.
- `4_api` maps HTTP requests and application results. Routes receive already
  wired use cases and neither construct them nor import applications or
  adapters.
- `5_composition` is the sole cross-layer wiring point. It constructs the Libby
  adapters and injects their capabilities into the application use cases and
  routes. It contains no provider policy or HTTP behavior.

Tests must keep the architecture import checks green in addition to exercising
behavior. Provider-shaped data is translated at the adapter boundary before it
reaches the existing content published language.

## Cover artwork

Book and part thumbnails use a same-origin Daylight route:

`GET /api/v1/proxy/libby/cover/:cardId/:titleId`

The cover application use case asks an injected Libby loan gateway to verify
that the exact card/title pair is still active and obtain its translated cover
reference, then asks an injected image gateway to open it. The adapter accepts
only HTTPS URLs on the configured OverDrive image CDN allowlist, with the
default HTTPS port, follows redirects manually under the same validation, and
accepts only image content types. The API maps the neutral application result
to a private, `no-store` response with `X-Content-Type-Options: nosniff`.
Provider URLs and credentials never appear in the browser response or request
logs. Card and title IDs are already part of the public Daylight content
identity and are not authorization tokens.

## Daylight media and remote playback

The existing Media screen is the playback surface. Queue expansion through
`/api/v1/list/libby/loan/<cardId>/<titleId>` produces ordered audio entries
with their metadata, same-origin cover URL, and ephemeral stream URLs. The
normal queue router and AudioPlayer consume those entries without a Libby-only
frontend protocol.

`GET /api/v1/device/:deviceId/load?queue=libby:loan/<cardId>/<titleId>` uses the
existing warm websocket dispatch or cold screen-load path. Libby does not need
a Playback Hub integration: the office screen receives the same Media queue
shape as other audio providers. Libby's unsupported playback-preparation hook
remains a non-blocking skip.

## DaylightBrowser extension

DaylightBrowser is a provider-neutral browser-execution extension. It owns a
shared hardened browser pool, operation registry, lifecycle limits, and
sanitized observability. Each integration contributes a separately named,
schema-validated operation with its own origin and request-interception policy.
It never exposes a generic navigate, evaluate, fetch, or proxy endpoint. This
allows later operations—such as a policy-compliant YouTube resolver inspired by
Invidious, FreeTube, or PeerTube—to reuse the runtime without coupling their
provider vocabulary or security policy to Libby.

Modern Libby audiobook fulfillment may omit the legacy `openbook` URL. Its
authorized web shell instead embeds bootstrap data that Libby's official
JavaScript turns into the in-memory playable spine. Daylight delegates only
this bootstrap and bounded initial-player buffering step to a separately containerized extension at
`_extensions/daylight-browser`, following the deployment independence used by
`_extensions/fitness`.

The extension is built from a version-pinned official Playwright Chromium
image. Its first narrow internal operation is:

`POST /v1/operations/libby.bootstrap-loan`

The operation request carries a one-use Libby web URL/message capability supplied by the
backend. The extension creates a fresh browser context, executes the official
Libby bootstrap, waits for its metadata-ready book map, and validates that every
declared part is an unencrypted MP3 fulfillment. It then clicks official Play
once and permits normal player buffering for one fixed 20-second observation
window under a 30-second hard capture deadline. The context-wide bootstrap route
remains installed. After enabling operation-scoped CDP Fetch request-stage
interception on the original page, the route atomically flips to a media policy:
only original-page/main-frame GET Media requests to the exact shell origin or
exact HTTPS/default-port `audioclips.cdn.overdrive.com` origin may continue.
Before provider navigation, a context init script installs non-configurable
throwing `Worker` and `SharedWorker` constructors in every frame realm;
it also installs a non-configurable `BaseAudioContext.prototype.audioWorklet`
facade whose `addModule` throws for direct and Blob modules without disabling
`HTMLAudioElement`. All exposed page worklet loaders (`paint`, `layout`, and
`animation`, including equivalent global surfaces) receive the same sealed
facade without disabling ordinary CSS/layout APIs. Service workers remain blocked at context creation. Popup/extra-page initial
navigation, routable worker traffic, navigation, non-media, and foreign
traffic abort at the context route before egress. Original-page CDP remains the
authoritative redirect-hop gate and captures each CDN capability while paused.
Each captured capability is validated by a credential-free one-byte range
request, with its body canceled unread, and mapped uniquely by the declared
total length to the BIF spine. Capability arrival order is not spine order;
matches are sorted by declared index and must then be a nonempty, unique,
contiguous playback window beginning at the lowest officially observed mapped
spine index. The window may begin after zero when official playback resumes a
saved position. Returned indexes are normalized to zero-based array order while
stable original-spine identity fields are retained. The result contains only
that observed window. Analytics, activity/error reporting, unrelated
navigation, foreign media, and downloads are blocked. The official player may
buffer authorized media bytes only inside this bounded ephemeral context; the
operation never reads, returns, or deliberately retains those bytes, and
container memory/tmpfs limits bound resource use. Browser profiles, cookies,
caches, downloads, capabilities, and response bodies are never persisted. The
media policy flips to block-all and the media page is closed while CDP enforcement remains active; only after confirmed
page closure is interception disabled/detached and independent range probing
begins. If page closure fails, enforcement remains installed while pool-level
context/browser teardown runs. The context is destroyed after each operation.

This bounded saved-position window is sufficient for immediate playback, but it is not a
full-book contract: later-part continuation is not yet guaranteed. The
implementation must not synthesize or infer capabilities for unseen parts.

The operation registry dispatches only exact versioned operation names. Shared
runtime code cannot weaken an operation's origin allowlist, interception rules,
response schema, or redaction policy. New operations require their own tests,
backend port/gateway, and composition binding; they do not modify Libby code.

The pool creates an operation-owned abort signal combining caller cancellation
with its hard deadline. Capability probes use that signal. A slot remains owned
until operation settlement and context cleanup complete within the cleanup
bound; a worker that ignores cancellation poisons the pool so later work cannot
overlap it.

The container has no credential-file or Daylight data mounts and no published
host port. It runs as a non-root user with a read-only root filesystem, tmpfs
browser storage, dropped capabilities, bounded CPU/memory, one-operation
concurrency, and a hard deadline. Its structured logs contain operation IDs and
categorical outcomes only.

Within the backend, an application-owned bootstrap port accepts the semantic
loan-bootstrap request and returns the normalized spine. A thin
`1_adapters/content/media/libby/DaylightBrowserLibbyGateway.mjs` implementation
calls the extension over the private Docker network. `5_composition` chooses
the browser-backed path when configured and retains the legacy openbook path
only for provider responses that explicitly supply a valid openbook URL. No API
or domain layer imports extension code.

The returned upstream URLs remain adapter-internal capabilities. They are
immediately wrapped in the existing process-local Libby stream leases, never
returned by queue or catalog APIs, and never written to durable storage.

## Scope and acceptance

V1 supports explicit IDs in browser Media surfaces and remote standard Media
screens. It does not browse all loans, borrow, renew, return, sync upstream
progress, cache audio, concatenate parts, add a separate Playback Hub
transport, or bypass DRM. Any encrypted/license-controlled fulfillment is
unsupported.

Acceptance for the current loan requires all of the following:

- Authenticated provider opening of `libby:loan/77089338/3070848` returns its
  audiobook spine using `website_id` derived from the active loan and, when the
  provider omits openbook metadata, the DaylightBrowser bootstrap operation.
- Queue expansion returns ordered audio parts with title, subtitle, author,
  narrator, duration, and the same-origin cover route.
- The cover route returns a validated image without exposing or persisting a
  provider URL.
- Loading
  `/api/v1/device/office-tv/load?queue=libby:loan/77089338/3070848` causes the
  office Media screen to play the first captured part and retain any other
  captured initial-window parts in its queue. Later-part continuation is not a
  current acceptance claim.
- No JWT, cookie, signed media URL, cover-provider URL, or media bytes are
  written to logs or durable storage.
