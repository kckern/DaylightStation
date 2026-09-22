# Media App Documentation

The doc set for the Media App (`/media`) — the household's universal content
front door and universal remote. Together these documents are the design
source-of-truth: sufficient to rebuild the app from scratch.

| Doc | Layer | Contents |
|-----|-------|----------|
| [`media-app.md`](./media-app.md) | **Intent & design** | Why the app exists, objectives, user stories, the nine user journeys (J1–J9), shell anatomy, views, navigation & URL paths, design principles, conceptual subsystems. **Start here.** |
| [`media-app-requirements.md`](./media-app-requirements.md) | **Requirements** | Numbered normative capabilities (C1–C10), session model & lifecycles, external interfaces, non-functional requirements (N1–N6). |
| [`media-app-technical.md`](./media-app-technical.md) | **Contracts** | Every wire-level contract: HTTP endpoints, WebSocket topics & envelopes, URL contract, canonical data shapes, log event taxonomy, localStorage schema, error envelopes. |
| [`search-scopes.md`](./search-scopes.md) | **Feature reference** | Config-driven search scope system: YAML structure, params, app behavior. |
| [`dash-video-resilience.md`](./dash-video-resilience.md) | **Troubleshooting** | DASH/Plex transcode stall & seek failure modes and debugging checklist (player-layer, shared with other apps). |
| [`integration.md`](./integration.md) | **Integrations** | Provider-specific media boundaries, including Libby audiobook fulfillment and authentication/expiry behavior. |

Related: the content paradigm (`docs/reference/content/`) defines content IDs,
formats, the Playable Contract, and the Play/Queue/Info/Display/List APIs the
Media App is a thin client over.

Libby audiobook loans are available to the browser AudioPlayer through explicit
`libby:loan/<card-id>/<title-id>` content IDs. The integration is intentionally
ephemeral: it verifies an active loan, returns opaque same-origin stream leases,
and neither downloads nor catalogs the account. Queue expansion keeps each part's
title, duration, ordering, book title, subtitle, author, and narrator. Artwork is
served through the private, no-store same-origin cover proxy. Remote playback
uses the standard Media screen's queue dispatch and browser AudioPlayer, with
no Playback Hub dependency. The provider's `website_id` is derived from the
synchronized active loan rather than supplied by the caller. Modern fulfillment
uses the independently deployed DaylightBrowser extension to execute the official
web bootstrap in an ephemeral Chromium context; explicit legacy OpenBook
fulfillment retains its existing path. Modern browser fulfillment currently
returns the validated contiguous window exposed by official initial buffering
at the player's saved position; it enables immediate playback but does not
guarantee earlier parts or continuation through later book parts. See the [DaylightBrowser runbook](../../runbooks/daylight-browser.md)
for private networking, configuration, updates, and opt-in live verification, and the proxy contract in
[`media-app-technical.md` §2.1](./media-app-technical.md#21-content-resolution).
