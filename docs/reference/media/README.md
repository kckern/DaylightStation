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

Related: the content paradigm (`docs/reference/content/`) defines content IDs,
formats, the Playable Contract, and the Play/Queue/Info/Display/List APIs the
Media App is a thin client over.
