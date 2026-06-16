# Transport-Agnostic Display/Scene Delivery — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

**Sub-project 3b** in the ArtMode rework (follows sub-project 3, which shipped the
triggered scene for the FKB/living-room transport). Sub-project 3 worked only because
the FullyKiosk adapter forwards the entire load URL (so `?display=art:` rides along to
`ScreenAutoplay`), and it coupled the scene handler to `ScreenScreensaver` (which only
exists where a `screensaver:` block is configured).

Two gaps surfaced when trying it on **office-tv**:
1. Office has no `screensaver:` block → no `ScreenScreensaver` → the scene handler never
   mounts → ad-hoc trigger is dead.
2. Office uses `content_control.provider: websocket` → `WebSocketContentAdapter`, which
   does **not** load a URL. It calls `resolveContentId(query)` against
   `CONTENT_ID_KEYS` (media ids only: queue/play/plex/hymn/primary/scripture/contentId)
   and broadcasts a structured `CommandEnvelope`. `display` is not a content-id key →
   the office load fails with "no contentId could be resolved."

## Purpose

Make `GET /device/:id/load?display=art:<preset>` engage the ArtMode scene on **any**
target — FKB (living-room) and WebSocket (office) alike — and on **any** screen,
whether or not it has a screensaver configured.

## The unifying seam

Both transports converge on a single event — **`display:content`** on the screen's
action bus — handled centrally by `ScreenActionHandler` (which is always mounted,
independent of screensaver config):

```
/device/:id/load?display=art:<preset>
  ├─ FKB:  /screen/...?display=art:<preset>  → ScreenAutoplay → bus.emit('display:content', {id})   (already works)
  └─ WS:   `display` CommandEnvelope on topic → useScreenCommands → bus.emit('display:content', {id})  (NEW)
        → ScreenActionHandler.handleDisplayContent:
             id starts 'art:' → GET /api/v1/art/preset/<preset>
             → showOverlay(ArtMode, props, { mode:'fullscreen', priority:'high' }), onExit = dismissOverlay
```

## Components

### 1. Move the scene handler → `ScreenActionHandler` (decoupled)

Move the `display:content` art-scene logic OUT of `ScreenScreensaver` and INTO
`ScreenActionHandler` (which already imports `DaylightAPI`, `getWidgetRegistry`,
`useScreenOverlay`/`showOverlay`, and handles `display:overlay`). It:
- subscribes via `useScreenAction('display:content', handleDisplayContent)`,
- claims only `art:<preset>` ids (others ignored — left for a future generic display path),
- fetches `GET /api/v1/art/preset/<preset>`, and on success
  `showOverlay(getWidgetRegistry().get('art'), { ...props, onExit }, { mode:'fullscreen', priority:'high' })`
  where `onExit = () => dismissOverlay('fullscreen')`,
- on 404 / fetch failure, logs and engages nothing.

Because `ScreenActionHandler` is mounted for every screen, this works on office (no
screensaver) and living-room alike. The scene uses the `art` widget explicitly (an
art-scene dispatch shows ArtMode regardless of the screen's own screensaver widget).

The sub-project-3 scene code in `ScreenScreensaver` is **removed** (handler + its test),
since the central handler supersedes it. `ScreenScreensaver` returns to owning only the
passive idle/boot screensaver. On a screen with a screensaver, after the scene's
`onExit` dismisses, the screensaver's own idle timer resumes the default — no coupling
needed.

### 2. Extend the command protocol with a `display` kind

`shared/contracts/media/commands.mjs` — add `display` to the recognized command kinds
(`isCommandKind('display') === true`).
`shared/contracts/media/envelopes.mjs` — `validateCommandParams` gains a `display`
branch requiring `params.contentId` (non-empty string).

This makes "display this content id" a first-class structured command alongside
`transport` / `queue` / `config` / `adopt-snapshot` / `system` — the clean realization,
rather than overloading an existing kind.

### 3. WebSocket adapter carries the display intent

`WebSocketContentAdapter.load(path, query)` — branch: if `query.display` is a non-empty
string, build a `display` envelope (`buildCommandEnvelope({ targetDevice, command:'display',
commandId, params:{ contentId: query.display } })`) and broadcast it; skip the media
`resolveContentId` requirement for that path. The existing media path (CONTENT_ID_KEYS →
`queue` envelope) is unchanged.

### 4. `useScreenCommands` routes the display command

`useScreenCommands` — add `if (command === 'display') bus.emit('display:content', { id: params.contentId, commandId });`.

### 5. `WakeAndLoadService` — display-only load completes

Confirm a `display`-only load (no `queue`/`open`) runs the wake/load cycle and that
`display` survives in `contentQuery` to the adapter. Prewarm is already skipped without a
`queue`. Expected: no code change; covered by a test and the live check.

## FKB path: unchanged

The FKB/living-room path keeps working via the URL: `?display=art:` →
`parseAutoplayParams` → `ScreenAutoplay` → `bus.emit('display:content', …)` → the same
central `ScreenActionHandler`. No FKB adapter change. The two transports differ only in
how the event reaches the action bus; the handler is shared.

## Error handling

- Unknown preset (`404`) → handler logs `artmode.scene.unknown`, engages nothing.
- WS load with `display` but the office screen offline → broadcast no-ops (existing WS
  behavior); logged.
- A `display`-only device load still powers/wakes the display and delivers the command;
  no media content required.
- Non-`art:` `display:content` ids → ignored by the handler (reserved for future).

## Docs to update (per docs/reference rules — present-tense endstate)

- `docs/reference/content/content-model.md` — note the `display` command kind in the
  structured command protocol and that `display:content` is delivered transport-agnostically
  (FKB URL param and WS command both converge on the `display:content` action).
- `docs/reference/screen-configs.md` — document triggering ArtMode via
  `/device/:id/load?display=art:<preset>` (works on any screen/target; no screensaver
  required) and that the passive screensaver (`screensaver.preset`) is separate.
- If a device-load / command-protocol reference page exists under `docs/reference/`
  (e.g. trigger or core), add the `display` command there too.

## Testing

- **shared-contracts:** `isCommandKind('display')` true; `validateCommandEnvelope` accepts
  a `display` envelope with `params.contentId` and rejects one missing it.
- **WebSocketContentAdapter:** `load({ display:'art:x' })` broadcasts a `display` envelope
  with `params.contentId === 'art:x'` and returns `ok:true`; `load({ queue:'plex:1' })`
  still broadcasts a `queue` envelope (unchanged); `load({})` still returns the
  no-contentId error.
- **useScreenCommands:** a `display` CommandEnvelope → `bus.emit('display:content', { id })`.
- **ScreenActionHandler:** `display:content` with `art:<preset>` → fetch
  `/api/v1/art/preset/<preset>` + `showOverlay` with the props + `priority:'high'` +
  `onExit`; non-art id ignored; 404 → no showOverlay.
- **ScreenScreensaver:** scene code removed; passive idle/boot behavior unchanged
  (existing screensaver tests stay green; the sub-project-3 scene test is removed).
- **Live:** `GET /device/office-tv/load?display=art:classical-evening` engages ArtMode on
  the office screen; `GET /device/livingroom-tv/load?display=art:classical-evening` still
  works.

## Out of scope

- Generic `display:content` for non-art ids (image/canvas/slideshow Player path).
- Menu-launch entry for ArtMode (a menu item would simply emit the same
  `display:content` `art:<preset>` — trivial once this lands).
- Sticky scenes (still one-shot).
