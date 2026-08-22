# Media App — Mobile Search & Dispatch Taxonomy Redesign

**Status:** Approved design, pending implementation plan
**Companion:** `docs/superpowers/plans/2026-08-21-mediaapp-cast-failure-remediation.md` (backend/cast fixes from the same incident — independent of this spec, ships regardless)
**Supersedes (on approval):** the search-bar/scope portions of `docs/reference/media/media-app.md` §"One shell, three regions" and `docs/reference/media/search-scopes.md` §"App Behavior" — update both docs as part of implementation.

## Why

The 2026-08-21 incident (a 7-minute, ultimately failed attempt to put one video on the piano tablet from a phone) exposed that the mobile Media App fails at its own objective #1 ("one front door"). Audit findings from driving the real UI at 360×740:

1. **Inverted dock hierarchy.** Idle, the 360px dock gives the scope `<select>` 96px, the search input **50px** (placeholder doesn't fit), and the fleet/cast/settings cluster 168px. The primary action gets 14% of the bar.
2. **Search results render in a desktop popover** anchored under the dock (~40% of viewport), with stale canvas content visible behind it.
3. **The "Searching:" source-badge cloud** (16 adapter names — FILES, PLEX, CANVAS-FILESYSTEM, RETROARCH, …) fills the entire above-the-fold popover area while the stream runs. Users see infrastructure vocabulary instead of results.
4. **Scope is the wrong control in the wrong place with the wrong persistence.** A native `<select>` that is 96px/13px on mobile, `display: none` while the search field is focused (the one moment scope matters), and persists the last scope in localStorage forever — which is how a search for a kid's video ran silently against the Ambient music library days after anyone chose it.
5. **The dispatch model is modal and the mode is invisible.** A result tap dispatches to the current target (local browser by default, or the dock chip's device). The model itself is sound — one-tap repeat casts are a documented story — but nothing near the results says where a tap will send content, and the mode control (the chip) is hidden while searching on mobile.
6. **Home doesn't earn its screen.** "Recent" renders as an empty text row while four "Browse X" cards duplicate the Browse tab directly below them.
7. **The idle mini player reserves a permanent dead strip** to display the word "Idle".

## Design

### D1. Mobile dock: search-first

On phone widths the dock reduces to **a full-width tappable search field** (reads "Search media…", magnifier icon) **plus the settings gear**. It is a *launcher*, not an input: tapping it opens Search Mode (D2). The scope select, fleet indicator, and cast chip leave the dock on mobile:

- Fleet status → badge on the **Devices** tab (bottom nav).
- Cast target → visible inside Search Mode as the destination line (D4) and unchanged on Now Playing.
- Settings stays in the dock.

Desktop/tablet keep the persistent inline search bar (results as dropdown), but inherit D3–D5 (chips, collapsed source line, destination visibility, tap grammar).

### D2. Search Mode (mobile): a full-screen surface

Tapping the dock field opens a surface that owns the viewport:

```
┌──────────────────────────────┐
│ ✕  [ Boy from the moon    ]  │  ← input, autofocused, keyboard up
│ ▶ Playing to: This browser ▾ │  ← destination line (D4)
│ (All) Video Music Books  …   │  ← scope chips (D5)
│ ── Searching 16 sources… ──  │  ← one-line stream status (D3)
│ ┌──────────────────────────┐ │
│ │ 🎬 A Boy From The Moon   │ │  ← results fill the rest,
│ │ 🎞  Moon (2009)      ▶  ⋯│ │     paint as sources answer
│ │ 📀 Moon Safari       ▶  ⋯│ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- Entered via dock tap; exited via ✕, hardware/gesture back, or a successful dispatch (which returns to the prior view with a confirmation toast).
- State (text, chips, results) survives within the mode; leaving discards it. Typed text is **never** destroyed by a commit gesture (see remediation plan Task 4: Enter on settled-empty keeps the box open).
- Body scroll is contained (`overscroll-behavior`) — no pull-to-refresh remounts.

### D3. Stream status: one line, never in the results' way

The per-source badge cloud is replaced by a single thin status line between chips and results: "Searching 16 sources…" with a spinner, ticking down as sources answer ("3 still searching…"), collapsing to nothing when settled. Source errors surface *in the same line* when — and only when — they matter: "Plex didn't answer · Retry". Results paint incrementally as each source responds; the first fast source's rows appear immediately, above the still-running status line.

### D4. Destination line: the modal dispatch state, made visible

Search Mode always shows the current dispatch destination: "▶ Playing to: **This browser**" / "**Piano Tablet**". Tapping it opens the device sheet: **every device with `content_control` is always listed** (the preferred/last target is preselected, never a filter), with live online/offline state. Changing it here changes the same state the dock chip and CastTargetProvider hold — two views of one value.

Every dispatch confirms with the destination named: "▶ A Boy From The Moon → Piano Tablet". A forgotten setting surfaces in the toast immediately, not when the wrong screen lights up. A failed dispatch surfaces the *specific* failure (from the remediation plan's adapter fixes: e.g. "Piano Tablet rejected credentials") with a Retry that re-uses the same content + target.

### D5. Scope: chips inside search, catalog-wide default

- Scopes render as **tappable chips** under the input: `(All) Video Music Books …`. A parent chip with children expands them inline as a second chip row (`Music → Library · Hymns · Children's · Ambient`).
- **Every entry into Search Mode starts at All.** Chip selection lasts for the current search session only. The `media-scope-last` localStorage key is retired. (This implements the docs' stated "catalog-wide by default" and eliminates the stale-scope trap class.)
- **Scoped zero-result fallback:** when a scoped search settles empty, the surface automatically runs the same query at All and labels it: "Nothing in Music › Ambient — showing 4 results from everywhere." The chip stays selected so the user sees what happened.
- Config (`searchScopes` in `data/household/apps/media/config.yml`) and the `params` contract are unchanged. Desktop's dropdown gets the same chips in its popover header, replacing the `<select>`.

### D6. Tap grammar: one rule everywhere

Applies to search results, browse rows, and desktop dropdown alike:

| Gesture | Playable leaf (track/movie/episode/hymn) | Container (album/show/artist/playlist/folder) |
|---|---|---|
| **Tap row** | Dispatch: **play now** on current destination | **Browse into it** (never an accidental queue blowaway) |
| **Trailing ▶** | — | Dispatch: **play as queue** on current destination |
| **Trailing ⋯** | Play Now · Play Next · Up Next · Add to Queue · Open detail | (containers use browse view's header actions) |

- Movies are leaves: tap plays; detail is one tap away via ⋯ and via browse.
- Playing a container replaces/loads it as the session queue on the destination (existing queue semantics).
- **Container browse view opens with a dispatch header.** Since tap-into-container is the safe default, the browse view must immediately serve the "I just wanted to play this" intent: a prominent header bar directly under the container title with **▶ Play · 🔀 Shuffle · + Queue** and the destination shown inline (the same D4 destination line, tappable to change). One tap into an album, one tap on Play — browsing in costs nothing over play-on-tap, and the destination is confirmed visually before anything fires.

### D7. Home and mini player cleanup

- Home leads with **Recent** (real items, once any exist) and curated rows; the four "Browse X" cards are removed (the Browse tab is one thumb-tap below).
- The mini player renders **only when a local session exists**; no idle strip.

## Error Handling

- Source errors: status-line surfacing per D3; a single-source failure never blanks the results of the others.
- Scoped-empty: automatic All fallback per D5 — an empty state without an explanation and an exit is a design violation.
- Dispatch failure: named-device, named-cause toast with Retry per D4 (depends on remediation plan Tasks 2–3 for truthful causes).
- Offline destination: the device sheet shows offline state; dispatching to an offline device is allowed (wake is part of the pipeline) but the progress tray is shown so the wait is visible.

## Observability (extends the remediation plan's logging track)

New/changed structured events (frontend, `context.app: media`):

- `search.mode_entered` / `search.mode_exited` `{ trigger }` — mobile mode lifecycle.
- `search.dispatch` gains `{ scopeKey }`; `search.settled` (per remediation Task 5) gains `{ scopeKey, fellBackToAll: bool }`.
- `search.scope_selected` `{ scopeKey, viaFallback: false }`.
- `dispatch.destination_changed` `{ from, to, surface: 'search-mode' | 'dock-chip' | 'device-sheet' }`.
- `cast.sheet_opened` `{ offeredDeviceIds }` — closes the "which devices was the user even shown" gap that made incident failure #6 unrecoverable from logs.

## Testing

- `comboboxMachine` / scope-chip reducer logic: vitest unit specs (pure decision functions for chip selection, fallback trigger, tap-grammar routing by item type).
- Search Mode enter/exit/state-survival and destination-line rendering: component tests alongside existing `MediaContentSearch.test.jsx` patterns.
- One Playwright flow test at 360×740: open /media → tap search → type → chip filter → result tap → local playback (extends `tests/live/flow/`); assert the destination line is visible while the keyboard-height viewport is active.
- The 2026-08-21 journey (scoped-empty → fallback finds item → destination switch → dispatch) as the acceptance scenario.

## Non-Goals

- No changes to the content APIs, search stream endpoint, or scope config schema.
- No redesign of Browse, Peek, Fleet, or Now Playing beyond the affordances named here.
- No per-row multi-target casting (the modal destination model is retained deliberately).
- Desktop keeps its persistent-bar model; this is not a desktop restyle.

## Doc Updates on Implementation

- `docs/reference/media/media-app.md`: dock/shell diagram and Discover stories (search-as-mode on mobile, destination line).
- `docs/reference/media/search-scopes.md`: chips UI, default-All, session-only persistence, fallback behavior; retire `media-scope-last`.
