# Media Docked Video Mini-Player — Design

**Date:** 2026-07-16
**Status:** Awaiting user review (design chosen on best judgment while user was away — confirm before planning)
**Module:** `frontend/src/modules/Media/`

## Goal

Give the Media module's onboard **video** playback a Plex-style **docked mini-player**: while a video is playing and the user is browsing/searching (not on the full Now Playing screen), show the **live video** small, on the **left of the play bar**, and **promote to the larger Now Playing view on click**.

Audio playback and the idle state are unchanged.

## Background: how playback renders today

(Established by reading the module; see `file:line` refs.)

- **One Player instance.** `session/PlayerBridge.jsx` mounts the platform Player (`modules/Player/Player.jsx`) exactly once, as a permanent sibling of the app (`LocalSessionProvider.jsx:105`). It never unmounts while the app is open — playback is ambient.
- **Portal host mechanism.** PlayerBridge reads `PlayerHostContext` (`session/playerHostContext.js`). If no host is claimed, it parks the Player off-screen (`position:fixed; left:-10000px`) so audio keeps playing invisibly; if a host element is claimed, it `createPortal`s the *same* Player instance into that host (`PlayerBridge.jsx:169-198`). Moving the host never remounts the Player, so playback is continuous.
- **Claiming the host.** `session/usePlayerHost.js` — `usePlayerHost(ref)` sets the host to `ref.current` on mount and back to `null` on unmount. **Today this is last-writer-wins on a single ref** — there is no priority; two simultaneous claimants would race on React effect ordering.
- **Only one claimant today.** `shell/NowPlayingView.jsx:47` claims the host into `.now-playing-host` (`NowPlayingView.jsx:94`), a `width:100%; aspect-ratio:16/9` pane (`MediaShell.scss:276-287`).
- **The play bar.** `shell/MiniPlayer.jsx` is the always-visible bottom bar (`MediaAppShell.jsx`, `MediaShell.scss:198-262`, height `--media-mini-h:60px`). Left→right it renders: a thin top progress strip, a **static 44×44 thumbnail** (`MiniPlayer.jsx:65-67`), a title button that pushes the `nowPlaying` view (`MiniPlayer.jsx:68-80`), and play/pause · next · stop (`MiniPlayer.jsx:81-111`). **There is no video surface in the bar today** — just the static thumbnail. This thumbnail slot is where the docked video goes.
- **Video vs audio signal.** Queue items carry `format: 'audio' | 'video'`, derived by `formatForChild` from the item type or `mediaType` (`session/containerExpansion.js:28-76`). Video detection uses `currentItem.format === 'video'`.
- **State access.** All chrome reads `controller/useSessionController('local')` → `{ snapshot, transport, ... }`; `snapshot.currentItem` is "what's playing", `snapshot.state` (via `PLAYING_STATES`) is play/pause. Current view comes from `useNav()` (`view === 'nowPlaying'`).
- **Styling.** Global SCSS (not modules) + Mantine CSS vars. Layout heights are CSS custom properties in `frontend/src/Apps/MediaApp.scss:8-10`.

## Chosen approach

Reuse the existing portal + Now Playing view. Add exactly two things: (1) a **priority-aware host claim** so two views can want the Player and the correct one wins; (2) a **live-video dock** in the MiniPlayer's left slot for video content when Now Playing is closed.

**Rejected alternatives:**
- *Floating PIP overlay* (detached, draggable, over content) — more work, overlaps content, and the request says "in the play bar," not floating.
- *New true-fullscreen promote target* — the request says "promote to larger," and a larger view already exists (Now Playing). Adding a fullscreen mode is out of scope (YAGNI); can be a later, separate spec.

## Design

### 1. Priority-aware Player host

Replace the single-ref host claim with a small **claim registry** so the Player portals to the highest-priority active claim.

- **Provider** (extend the existing host provider in `LocalSessionProvider.jsx`, or a small dedicated provider in `session/`): holds a set of claims, each `{ id, el, priority }`. The **active host** = the claim with the highest `priority` (ties broken by most-recently-added). Publishes that `el` on `PlayerHostContext`. When the set is empty, publishes `null` (Player parks off-screen — unchanged behavior).
- **Hook:** `usePlayerHost(ref, priority = 1)` registers a claim on mount (and when `ref.current`/`priority` changes) and unregisters on unmount. A claim whose `ref.current` is `null` is treated as "no element" and does not win.
- **Claimants:**
  - `NowPlayingView` → `usePlayerHost(hostRef, 2)` (behavior identical to today when it's the only claimant).
  - MiniPlayer video dock → `usePlayerHost(dockRef, 1)`, only while it should host (see §2).
- **Why priority, not mutual exclusion:** gating the dock purely on `view !== 'nowPlaying'` would rely on React cleanup ordering between sibling components during the transition, risking a one-frame host drop/flicker. A priority registry makes Now Playing deterministically win while it's mounted and hands back to the dock on unmount, with no dropped frames. It also future-proofs a fullscreen claimant.

**Interface contract (`usePlayerHost`):**
- Input: `ref` (a React ref to a DOM element or null), `priority` (number, default 1).
- Effect: while mounted, contributes a claim; the provider portals the single Player into the highest-priority non-null claim.
- Backward compatibility: existing `usePlayerHost(ref)` calls keep working (default priority 1). Only `NowPlayingView` is updated to pass `2`.

### 2. MiniPlayer video dock

In `shell/MiniPlayer.jsx`, replace the static-thumbnail slot with a conditional:

- **Show the live-video dock** when `currentItem.format === 'video'` **and** `view !== 'nowPlaying'`:
  - Render a dock element (`ref = dockRef`, class `mini-player-video-dock`) in the left slot, sized to the bar height at 16:9.
  - Call `usePlayerHost(dockRef, 1)` so the Player portals into it. (Hook is called unconditionally per React rules; it contributes a null claim — no-op — when the dock isn't rendered, e.g. by keeping `dockRef` null in that case.)
  - The dock tile is a click target (button/overlay) that promotes: `push('nowPlaying', {})` — same action as the existing title button. The video element itself is non-interactive in the dock; transport stays in the bar controls.
- **Show the static thumbnail** (today's behavior) when audio, idle, or `view === 'nowPlaying'` (on Now Playing the video is already in the big pane; the bar shows the thumbnail as today).

No change to the title button, progress strip, queue count, or the play/pause·next·stop controls.

### 3. Styling

- New class `.mini-player-video-dock` (in `shell/MediaShell.scss`, near the `.mini-player` block `:198-262`): fixed 16:9 box, left-aligned, height ≈ bar inner height, `overflow:hidden`, rounded corners, subtle border, `cursor:pointer`. It must **not** inherit the `.now-playing-host video,audio,iframe { width:100%;height:100% }` fill rule — give the dock its own `video { width:100%; height:100%; object-fit:cover|contain }` scoped to `.mini-player-video-dock`.
- New CSS var `--media-dock-video-w` (in `frontend/src/Apps/MediaApp.scss:8-10`) so the dock width is tunable without touching JS. Width derives from the bar height × 16/9 by default (≈ 96px for a 54px inner height); the var lets us make it larger later.
- The bar's overall height (`--media-mini-h`) is unchanged; the dock fits within it.

## Data flow

```
PlayerBridge (one Player instance)
   └─ portals into → PlayerHostContext.activeHost
                        = highest-priority claim:
                          NowPlayingView(2) > MiniPlayer dock(1) > none(null → off-screen park)

MiniPlayer:
   currentItem.format === 'video' && view !== 'nowPlaying'
     → render .mini-player-video-dock, claim host@1, click → push('nowPlaying')
   else
     → static thumbnail (unchanged)
```

## Edge cases

- **Browse ↔ Now Playing transition:** priority registry keeps the Player hosted throughout; the single instance never remounts, so video/audio does not stop or restart.
- **Audio content:** never renders a video box — the dock condition is `format === 'video'` only; audio shows the thumbnail.
- **Idle (no `currentItem`):** unchanged "Idle" bar.
- **Item without a `format` field:** treat as non-video (thumbnail) — fail safe. (Plan must confirm `format` is present on `snapshot.currentItem`; fall back to `mediaType === 'video'` if needed.)
- **Fill-rule bleed:** the dock's own scoped `video` sizing prevents inheriting the Now Playing host's fill rules.
- **Live/iframe content:** out of scope for docking in v1 — only `format === 'video'` docks; anything else shows the thumbnail.

## Testing

- **Unit — priority host registry:** highest-priority claim wins; releasing the top claim falls back to the next; empty set → null; null-ref claim never wins; tie broken by most-recent.
- **Component — MiniPlayer:** renders `.mini-player-video-dock` only when `format==='video'` && `view!=='nowPlaying'`; renders the static thumbnail for audio, idle, and on-Now-Playing; clicking the dock calls `push('nowPlaying')`; transport controls unaffected.
- **Continuity (component/integration):** switching `view` between browse and `nowPlaying` keeps a single Player mounted (no remount), i.e. the host moves rather than the Player unmounting.
- Follow existing Media test patterns (`mockController`, `controllerShape`).

## Out of scope (possible follow-ups)

- True edge-to-edge fullscreen promote target.
- Draggable/detachable floating PIP.
- Docking non-video visible content (web/iframe).

## Open assumptions to confirm on review

1. **Promote target is the existing Now Playing view** (not a new fullscreen). — chosen.
2. **Dock lives inside the play bar's left slot** (replacing the thumbnail), sized to bar height at 16:9 — not a larger overlapping tile. If you want it bigger/overlapping the bar top edge, that's a `--media-dock-video-w` bump + minor layout, easy to adjust.
3. **Audio keeps the static thumbnail** (no change).
