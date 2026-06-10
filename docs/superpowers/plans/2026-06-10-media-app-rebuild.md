# Media App Ground-Up Rebuild

## Context

The Media App (`/media`) is the household's universal content front door + universal remote. The P1–P7 build (Feb–May 2026) got the provider architecture right but shipped chronically weak UX; 60+ fix commits (May–Jun) patched 14 audit defects (M1–M14) but the app remains utilitarian: emoji icons, bare lists, hand-rolled 46KB SCSS, one rough breakpoint, ref-mutation workarounds in the engine. The design intent is now fully documented in `docs/reference/media/` (rewritten 2026-06-10: `media-app.md` intent/journeys/design, `media-app-requirements.md` C1–C10, `media-app-technical.md` wire contracts). **This plan guts `frontend/src/modules/Media/` entirely and rebuilds it from those docs.**

**Decisions made with user:** full gut (engine + UI) · Mantine v7 + custom dark theme (Plex palette: bg `#101113`, panels `#17181b`/`#1c1d20`, amber `#e5a00d`, Inter) · @tabler/icons-react (no emoji) · phone-first (390px → 768 → 1200) · the 18 Playwright flows in `tests/live/flow/media/` are the acceptance gate (behaviors hold; testids may change).

**Fixed points (do not change):** backend APIs, WS topics, `shared/contracts/media/*` (via `@shared-contracts` alias), screen-framework device side, `PersistedSession` localStorage schema v1 (existing sessions must survive the flip). **Reuse:** `modules/Player/` (format registry — app never branches on format), `services/WebSocketService.js` (`wsService`), `lib/api.mjs`, `lib/logging/`, `hooks/useStreamingSearch|useStatusOverlay|useDismissable|useDocumentTitle`, `styles/_breakpoints.scss`.

**Staging:** in-place gut on a **git worktree branch** (CLAUDE.md preference). Old app keeps running from main; merge to main is the flip. Blast radius outside the module is exactly two files: `Apps/MediaApp.jsx`, `Apps/LiveStreamApp.jsx`.

## Target architecture (key moves)

```
frontend/src/modules/Media/
  index.js            # the only import surface for App + UI
  constants.js        # ALL named timings (ACK_TIMEOUT_MS 5s, STALL_THRESHOLD_MS 10s,
                      # DISPATCH_DEDUPE 5s, POSITION_PERSIST 5s, DEVICE_STALE 15s, …)
  net/ws.js           # single wsService touchpoint; topic builders from @shared-contracts
  theme/mediaTheme.js # createTheme: amber primary, dark ramp (dark[8]=#101113,
                      # dark[7]=#17181b, dark[6]=#1c1d20), Inter, 44px ActionIcon defaults
  identity/  logging/
  controller/         # controllerShape.js — THE symmetry seam:
                      # { getSnapshot/subscribe, position:{get/subscribe},  ← two-tier
                      #   transport, queue, config, lifecycle, portability, capabilities }
                      # useSessionController('local'|{deviceId}) via useSyncExternalStore
  session/            # sessionStore + pure reducer/queueOps/advancement (port near-verbatim)
                      # + attachments (persistence, recents, logging) + positionChannel (hot tier)
                      # + LocalSessionController facade + PlayerBridge (ports HiddenPlayerMount's
                      #   load-bearing Player quirks: ref validity, volume retry, stable tree)
  fleet/              # fleetStore w/ per-device subscriptions (heartbeats don't re-render all cards)
  peek/               # ackRouter (commandId→promise, ONE device-ack sub) + RemoteSessionController
  cast/               # dispatchStore (dedupe, retry, transfer-stops-local-only-on-success)
  externalControl/    # commandHandler validated via shared envelopes; useUrlCommand (token dedupe)
  shared/  search/  browse/  shell/   # UI: MediaShell grid, SessionSurface, QueuePanel, …
```

**Engine fixes over the old design:** stores live outside React (`useSyncExternalStore`) — kills the PeekProvider/DispatchProvider ref-mirror disease; the 347-line LocalSessionAdapter decomposes into store + pure ops + attachments + thin controller facade; position gets an explicit hot tier (`positionChannel`) so ticks only re-render seek bars, with persisted-tier writes on discrete events + 5s cadence; all magic timeouts centralized in `constants.js`; one conformance test suite runs against BOTH local and remote controllers to enforce the symmetry.

**UI keystones:** `SessionSurface` is one composite — NowPlaying = `<SessionSurface controller={local} hostsVideo/>`, Peek = `<SessionSurface controller={remote} optimistic/>`; QueuePanel is the single shared queue component. Mobile chrome: top bar (scope+search, cast chip, settings) / canvas / dispatch-tray strip / mini player / bottom tab bar (Home·Browse·Fleet+badge) — explicit per-breakpoint layouts, never flex-wrap (M14). Desktop: left rail + one-row dock. Search is a Mantine `Combobox` (keyboard model free); queue actions keep it open with row-flash feedback (M7); cast picker = `Drawer` bottom-sheet on mobile / `Popover` on desktop via a `ResponsiveSheet` wrapper. **Portal rule (M1 prevention):** portaled surfaces use only Mantine components + Mantine CSS vars — theming the `dark` ramp styles portals automatically. Optimistic peek controls via `hooks/useStatusOverlay` (flip instantly, pending ring, converge to device broadcast). Hard rules: no contentId/deviceId ever rendered as a label; every async surface ships loading (Skeleton) / empty (hint + action) / error (+ Retry); touch targets ≥44px. Icons: `IconHome/IconLayoutGrid/IconDevices` nav, `IconPlayerPlayFilled` etc. transport, `IconCast`, `IconDeviceRemote`.

NavProvider keeps single-route `?view=` query nav + in-app stack, fixing the popstate stack-collapse (restore stack from history state). Nav params (`view,path,contentId,deviceId`) and playback params (`play,queue,shuffle,shader,volume`) stay disjoint via one shared URL util.

## Phases

Each phase = commit(s) on the worktree branch, unit tests green (`vitest`), then its flow-suite slice green against the worktree dev server.

| # | Scope | Gate (flow suites) |
|---|---|---|
| **0. Prep & gut** | On main: move `modules/Media/LiveStream/` → `modules/LiveStream/`, fix import in `Apps/LiveStreamApp.jsx:4`, verify `/media/channels`. Then worktree branch: delete `modules/Media/`, scaffold dirs + `constants.js` + `net/ws.js` + `theme/mediaTheme.js` + MantineProvider wiring in `MediaApp.jsx` (AdminApp.jsx:38–132 pattern) + `MediaShell` grid + NavProvider + view placeholders + dismiss stack + **mock controller** so UI never blocks on engine. Copy this plan to `docs/superpowers/plans/2026-06-10-media-app-rebuild.md`. | `url-sync` |
| **1. Core session engine** | identity, controllerShape, sessionStore + pure modules (port reducer/queueOps/advancement/persistence assertions) + attachments, positionChannel, LocalSessionController, PlayerBridge, LocalSessionProvider, useUrlCommand, usePlaybackStateBroadcast, externalControl. Live-content (`isLive`) handling: stall suppression, transport collapse. | — (unit only) |
| **2. Local experience** | MiniPlayer, NowPlaying (SessionSurface + TransportBar + SeekBar + QueuePanel), settings menu + reset confirm. Real controller replaces mock. | `autoplay, resume, reset-confirm, stop-flow, mini-toggle, now-playing-exit` |
| **3. Discovery** | useLiveSearch/useListBrowse/useContentInfo/useMediaConfig hooks; Search combobox + scopes + deep-link pinned row + ResultRow; Home (resume/recents/config cards + empty states); Browse (breadcrumb chips, container vs playable rows, ⋮ overflow); Detail. | `discovery, search-states, search-lifecycle, deep-link-input, browse-breadcrumb` |
| **4. Fleet** | fleetStore (staleness, offline synthesis, per-device subs), FleetProvider, FleetView cards (real state colors, stale/offline badges), fleet tab badge. | `fleet` |
| **5. Peek** | ackRouter, RemoteSessionController, PeekProvider, Peek view (SessionSurface remote + optimistic overlay). Controller conformance suite vs both local & remote. | `peek` |
| **6. Cast & portability** | dispatchStore + DispatchProvider, cast target chip + ResponsiveSheet picker, inline cast from rows, dispatch tray + retry, useHandOff (adopt dispatch, transfer-stop-on-success), useTakeOver (claim + drift check). | `cast, inline-cast, handoff-picker` |
| **7. Harden & flip** | Log-taxonomy audit vs technical doc §10; N2 checks (500-item queue, tick re-render scope); queue reorder dnd + virtualization; a11y floor (`/` focuses search, Escape dismiss stack, focus restore, aria-live for mutations); 390/768/1200 screenshot refresh; full `vitest` + all 18 flows on worktree; persisted-session fixture test (blob captured from old app). Merge to main, deploy (allowed on this host), reload garage/office surfaces as needed, archive old-app audit docs. | `design-screens` + **all 18** |

Scope estimate: ~43 engine files / ~3.0k LOC + ~3.7k test LOC; UI roughly similar — comparable to the old module's ~9.2k, rebuilt clean.

## Risks

1. **Player imperative quirks (highest)** — ref only valid for some formats (`Player.jsx:876`), volume via `getMediaElement()` retry, stable tree hidden↔hosted or audio remounts. PlayerBridge is a faithful port of HiddenPlayerMount's engine half; covered by mini-toggle/stop-flow/now-playing-exit.
2. **Ack/state ordering** — acks may beat HTTP responses; timeout = "unconfirmed", not failed; device broadcast is ground truth. ackRouter unit tests for both orderings.
3. **localStorage compat** — keep schema v1 byte-compatible (incl. `wasPlayingOnUnload`, quota truncation, `url-command-token`); fixture test with a real persisted blob.
4. **`playback_state` heartbeat** — external dashboards consume it; no flow covers it → port its unit tests, assert ≤5s cadence + terminal `stopped`.
5. **Dispatch transfer ordering** — subscribe to `homeline` *before* the HTTP call; stop local only on confirmed success.
6. **URL param collisions** — engine URL-command reader and nav-stack writer share `location.search`; one shared param util, gated by `url-sync`.

## Verification

- Per phase: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media` then `npx playwright test tests/live/flow/media/<slice> --reporter=line` against the worktree dev server (capture the real runner exit/pass line, not the pipe's).
- Final: full `npm test` + all 18 media flows green; manual smoke on phone (390px) for J1 (search→play), J3 (cast to living-room TV), J5 (peek), J6/J7 (take over / hand off); `/media/channels` still renders (LiveStream relocation).
- Post-flip: deploy, verify `playback_state` broadcasts and device dispatch against the real fleet, watch `media-app.*` structured logs.
