# Media App Usability Audit

**Date:** 2026-05-15
**Status:** Complete
**Scope:** `frontend/src/Apps/MediaApp.jsx` and `frontend/src/modules/Media/**`
**Triggered By:** User report — "borderline unusable" for the primary use case (search → preview → play locally or cast)

---

## Executive Summary

The Media App's **infrastructure is essentially complete** — 7 active providers, a working streaming-search endpoint, a real dispatch pipeline, fleet enumeration with live device-state, peek/takeover/handoff machinery, persistence, external control over WebSocket. It implements most of the 9 documented user journeys (J1–J9) mechanically.

What's broken is the **surface**. The principal user journey — "find something, then play it here or send it there" — is split across three disconnected affordances (Dock search, Dock cast-target chip, in-result Cast button), three navigation depths (Dock → result → detail), and two cast flows (one-shot from result, hand-off from NowPlaying). There is **no Stop control**, only Pause; reset is disguised as a debug button. Search failures are silent. Browse, Fleet, Peek, Detail are all surfaced as peers of the primary flow, when they should be downstream of it.

**Bottom line:** the user is correct. The app supports its requirements but does not invite use. A flow-first reorganization — not a tear-down — fixes the principal complaints with minimal risk to working machinery.

---

## How Users Actually Use This App

From the user's own framing, the primary loop is:

> **Search → Find → (Optionally preview) → Play here OR Cast to a specific device → Done.**

A secondary, ambient need:

> **At any time: "what is playing? stop it."**

Every other capability documented in the requirements (browse, fleet observe, peek, takeover, hand-off, external trigger) is real but rare. They should remain reachable; they should not occupy the front of the screen.

---

## P0 Findings — Blocks the Primary Flow

### 1. No Stop control. Background audio orphans.

`MiniPlayer.jsx:23–36` exposes exactly two buttons: open NowPlaying, and toggle Play/Pause. There is no Stop, no Clear Queue, no end-the-session affordance anywhere on the dock.

Concrete failure mode (reported by the user): something is playing — they don't know what, can't see where, and pausing does not make it go away because the same item resumes the moment they click play again or refresh. The only escape is the **"Reset session" button** in `Dock.jsx:26–28`, which is presented as a debug control and gated behind a destructive confirm dialog ("This cannot be undone").

**Severity:** Critical. This is the "Bluey playing in the background, can't stop it" report verbatim.

**Fix:** Add a visible Stop (clears `currentItem`, halts the renderer, leaves queue intact) and a visible Clear Queue. Demote the existing Reset Session button to a hidden/settings location.

---

### 2. Cast is a two-step ritual across two surfaces.

`CastButton.jsx:9` disables itself when no targets are pre-selected:

```js
const disabled = targetIds.length === 0;
```

Targets are selected in a **completely different component** (`CastTargetChip` in the Dock). The result is:

- A user lands on a search result row.
- Every Cast button is grey/disabled.
- There is no inline affordance saying "Cast to which device?"
- The only feedback is a disabled button — which reads as broken, not as "configure first."

A user who hasn't found and operated the Dock's CastTargetChip popover **cannot cast anything**, ever, no matter how clearly they understand the rest of the app.

**Severity:** Critical. This is the "Where is the cast button? How do I cast from a result?" complaint.

**Fix:** On every result row (and detail view), the Cast affordance MUST present targets inline. The Dock's CastTargetChip is fine as a "default targets" shortcut, but it cannot be the only path.

---

### 3. Search has no error or empty state.

`SearchResults.jsx:21–24`:

```jsx
if (isSearching && results.length === 0) {
  return <div ...>Searching…</div>;
}
if (!results.length) return null;
```

`useStreamingSearch.js:87–99` does have error handling — but only emits warnings into the logger. The user-visible result is identical for:

- "Stream connection failed."
- "Adapter returned an error."
- "Query is below minimum length."
- "Query is well-formed but no results match."
- "Still typing."

This is the "I type in something and nothing pops up" complaint. The user cannot tell whether the search is broken, the query is bad, or the catalog has nothing for them.

**Severity:** Critical. Silent failures are worse than loud failures.

**Fix:** Distinguish four states: `idle` (no query), `searching`, `error <reason>`, `empty <"no results for X">`. Show each one explicitly.

---

### 4. No quick preview. Detail is a route, not a peek.

`SearchResults.jsx:54–60`: clicking the title navigates to a `detail` route (full Canvas takeover). Returning to the search drops your query — the search bar uses `useDismissable` (`SearchBar.jsx:22`) which collapses on outside clicks; navigating somewhere is an outside event.

So previewing an item costs you the search context. You either commit to drilling in, or never preview.

**Severity:** High. Breaks the user's stated need to "open it and review it — see the info, see the thumbnail — and then cast it."

**Fix:** Promote a per-row peek (inline expand or side-drawer overlay) so the result row can show title + thumbnail + description + actions without changing routes.

---

## P1 Findings — High friction, not strictly blocking

### 5. The Dock is six components in a horizontal smear.

`Dock.jsx:20–39` renders, with no spacing or grouping:

```
SearchBar | FleetIndicator | CastTargetChip | MiniPlayer | DispatchProgressTray | [Reset session]
```

`MediaApp.scss` is small (no real layout) and the result is visually equal weight across six independent UIs. The user has no hierarchy: search and "reset session" look like peer commands.

**Fix:** Make Search the dominant affordance (full-width or near-full-width). Group device/cast/now-playing into a separate cluster. Remove the Reset button from the Dock entirely.

---

### 6. Reset Session button is debug code in the production UI.

`Dock.jsx:26–28` is visible to every user, always. It's a destructive action with a scary confirm dialog. It is almost certainly a debug/testing affordance that escaped.

**Severity:** Medium. Probably the source of "what are all these buttons" — at least one of them looks like it shouldn't exist.

**Fix:** Move to a settings overflow menu, or behind a keyboard shortcut. Not in the primary Dock.

---

### 7. Two cast flows that don't share a model.

- **Result row / Detail view:** "Cast" — fires `dispatchToTarget` using the pre-selected Dock targets (`CastButton.jsx:11–18`).
- **NowPlayingView:** Hand-off — a separate UI with device dropdown + transfer/fork radios, hitting the same dispatch machinery via `useHandOff`.

These solve the same underlying problem (send content to a device) and ought to share the same target-picker UI. They do not.

**Severity:** Medium. Confuses users who think they understand "cast" and then meet "hand off" and have to learn it twice.

**Fix:** Single unified target-picker. Cast-from-result and hand-off-from-NowPlaying both invoke it; the only difference is whether the source is a content ID or the local session snapshot.

---

### 8. Browse buttons compete with Search.

`HomeView.jsx:38–47` renders one button per config entry: "Browse Music", "Browse Video", etc. These work — they navigate to `BrowseView` for hierarchical drilling — but they appear on the landing surface as peers of Search. The user complaint "Browse media, these don't even do anything" is technically wrong (they navigate); functionally right (they don't help with the primary task).

The requirements (C1.3) call for the home surface to expose curated entry points: recently-played, continue-where-you-left-off, quick-access categories. It currently exposes generic source-browse entry points, which are the slowest way to find anything.

**Fix:** Home surface = recent / resume / curated picks. Source-browse buttons live one tap deeper, not on the front page. Or: there is no separate Home; the empty-search state IS the home, surfacing recents/resume.

---

## P2 Findings — Dead or near-dead code

### 9. `LiveStream/` is unmounted.

`grep -rn LiveStream frontend/src/modules/Media/` returns zero imports outside the folder. `ChannelList`, `DJBoard`, `ProgramStatus` exist but are never rendered. Requirements (Out of Scope) explicitly say "creating, configuring, or programming livestream channels is a separate surface" — so this code shouldn't be here.

**Fix:** Delete or extract to its own module location outside MediaApp.

---

### 10. Pasting a content ID into the search box doesn't work as a deep-link.

`SearchBar.jsx:24–28` forwards the input verbatim to `useLiveSearch`, which hits `/api/v1/content/query/search/stream`. The endpoint does text search; it doesn't resolve `plex-main:12345` as an ID. So pasting an ID just queries for the literal string, usually returning nothing.

The user said this explicitly: "I put in the Plex ID, nothing happens."

The documented contract supports this in two places: URL deep-links (`?play=...` via §8 of the technical doc) and a direct Info/Play API. Neither is exposed in the search box.

**Fix:** Detect `<source>:<localId>` shapes in the input and offer a "Play this ID" / "Show info for this ID" affordance above text results, OR document that deep-linking is `?play=...` and don't let the input look like it accepts IDs.

---

### 11. `NavProvider` has a `depth` field that nothing consumes.

Minor — not user-facing, but signals incomplete iteration. Not in the user's pain bucket; flagging for plan hygiene.

---

## Gap vs. Requirements

The requirements (`docs/reference/media/media-app-requirements.md`) describe 9 user journeys (J1–J9), 10 capability groups (C1–C10), and treat discover/play/dispatch/observe/control as 5 first-class, concurrent capabilities. The current UI implements them as peer-weighted routes (`home | browse | detail | nowPlaying | fleet | peek`), with no enforcement of which is the primary entry.

A user reading the requirements would expect:

- A persistent, always-visible **search** with inline results and inline actions (C1.1, C1.1a).
- **Inline cast/dispatch from search results** with target selection per-action (C6.1, C1.1a).
- A live **mini status** of the local session with full transport, including Stop (C2.x, C9.x).
- Secondary surfaces (browse, fleet, peek) behind explicit navigation, not as peers of the entry surface.

The current implementation matches none of those expectations. It implements the building blocks but not the assembly.

---

## What's Working (Preserve)

Anything not listed in P0–P2 above is fine and should not be touched in an overhaul:

- All 7 providers (identity, session, fleet, peek, cast-target, dispatch, search). The data flow is correct.
- Streaming search endpoint and adapter response shape.
- DispatchProvider — dispatch IDs, WebSocket `homeline:*` progress, idempotency, retry. This is the load-bearing piece.
- Fleet enumeration + per-device state subscription. The data is there; the surfacing is fine when you reach it.
- Peek/Takeover/Hand-off machinery in `peek/` and `NowPlayingView.jsx`. Solid; just needs the unified target-picker (#7).
- External control over `client-control:<clientId>`. Correctly invisible by design.
- Persistence (queue, targets, scope) in localStorage. Survives reload.
- Logging through the framework (per `frontend/src/lib/logging/`) — already used throughout.

---

## Recommendations Summary

This audit recommends a **flow-first redesign**, not a rebuild. Specifically:

1. **Make Search the primary surface.** Empty-search state = recents/resume/curated. Typing-search state = inline incremental results with full per-row actions and a peek/expand.
2. **Per-row unified action surface.** Each result row gets: Play Here, Play Next, Up Next, Add, and **Cast → [target picker inline]**. The target picker is shared with NowPlayingView hand-off.
3. **Promote Stop.** MiniPlayer gains Stop alongside Play/Pause. Dock's "Reset session" button is removed from the front (move behind a settings/overflow menu).
4. **Search empty/error states.** Four explicit states: idle, searching, error (with retry), empty (with the query echoed).
5. **Deep-link recognition.** If the input looks like `<source>:<localId>`, offer it as a direct play/info action above text results.
6. **Demote browse/fleet/peek.** Reachable from a small navigation, not from the front canvas alongside Search.
7. **Delete LiveStream/** from this module.
8. **Single dispatch picker.** Cast-from-result and Hand-off-from-NowPlaying use the same component, parametrized on source (contentId vs session snapshot).

None of these touch the provider tree, the streaming-search backend, the dispatch pipeline, or the data shapes. All risk is in the shell and view layer.

---

## Out of Scope for This Audit

- Visual / aesthetic redesign (typography, color, motion). The audit is about *behavior* and *layout*, not skin.
- Backend / API changes. The contracts in `media-app-technical.md` are honored by the providers as-is.
- Mobile responsive specifics. Functional mismatches first; layout per-breakpoint second.
- Accessibility deep dive. Requirements N6 punts this; so does this audit.

---

## Code Reference Index (quick jumps)

| Symptom | File | Lines |
|---|---|---|
| Dock layout (6 peer components) | `frontend/src/modules/Media/shell/Dock.jsx` | 20–39 |
| MiniPlayer has no Stop | `frontend/src/modules/Media/shell/MiniPlayer.jsx` | 23–36 |
| Cast button disabled w/o pre-set targets | `frontend/src/modules/Media/cast/CastButton.jsx` | 9–18 |
| Search results — empty states | `frontend/src/modules/Media/search/SearchResults.jsx` | 21–24 |
| Streaming search error path (log-only) | `frontend/src/hooks/useStreamingSearch.js` | 87–99 |
| Result row → detail route (loses context) | `frontend/src/modules/Media/search/SearchResults.jsx` | 54–60 |
| Search bar collapses on outside click | `frontend/src/modules/Media/search/SearchBar.jsx` | 22 |
| Home renders config-driven browse buttons only | `frontend/src/modules/Media/browse/HomeView.jsx` | 38–47 |
| LiveStream module (dead) | `frontend/src/modules/Media/LiveStream/` | — |
| Search box does not parse `source:id` | `frontend/src/modules/Media/search/useLiveSearch.js` | 7–13 |
| Canvas — peer-weighted view routing | `frontend/src/modules/Media/shell/Canvas.jsx` | 11–21 |

---

## Resolved 2026-05-16

This audit drove `docs/superpowers/plans/2026-05-15-media-app-overhaul.md`.
28 commits between `324eec1b3` (first task) and `3fa8a01ec` (final design fix)
addressed all P0/P1 findings and most of P2.

### Status per finding

| ID | Finding | Status | Resolved by |
|---|---|---|---|
| P0-1 | No Stop control | ✅ Fixed | MiniPlayer Stop button calling `transport.stop()` (`a71f859cc`) |
| P0-2 | Cast requires pre-set Dock targets | ✅ Fixed | Unified `DispatchTargetPicker` opened inline from each row's Cast button (`1ce0fa1af`, `38636158e`) |
| P0-3 | Search silent failures | ✅ Fixed | Four explicit states — idle, searching, empty, error — with retry (`3bc9aa626`, `c7ab596ca`, `1eb7f4cb6`) |
| P0-4 | No quick preview | ✅ Fixed | Inline peek expansion preserves search context (`6e8551057`) |
| P1-5 | Dock crowded | ✅ Fixed | Grid layout, Search dominant, status cluster right-aligned (`249abb196`) |
| P1-6 | Reset is debug-in-UI | ✅ Fixed | Moved behind gear-overflow SettingsMenu (`324eec1b3`) |
| P1-7 | Two cast flows | ✅ Fixed | NowPlayingView hand-off now uses the same DispatchTargetPicker (`1b3ba0042`) |
| P1-8 | Browse competes with Search | ✅ Fixed | Home view restructured: Resume → Recents → demoted "Browse the catalog" (`505609553`) |
| P2-9 | LiveStream `dead` | ⏭ Skipped | Audit premise was wrong — `LiveStream/` is consumed by `LiveStreamApp` at `/media/channels/*` (`main.jsx:148`). Misfiled under `modules/Media/` but not dead. No user-impact in MediaApp; cleanup is a future architectural refactor outside this overhaul. |
| P2-10 | Plex ID input does nothing | ✅ Fixed | Idle-state deep-link affordance: typing `source:id` shows a "Play this ID" button that calls `queue.playNow` (`c7ab596ca`) |

### Test coverage

- **Vitest (component + unit):** 1673 tests across 317 files, all passing
- **Playwright (e2e flows):** 35 tests, all passing (see Phase 8 commits `2591d72c8` through `0195a245d`)
- **Screenshot reference set:** 7 canonical states captured at `docs/_wip/audits/media-app-screens/` (see `9cf6ad582`)

### Design review

A single-pass critique against the captured screenshots (`e8b9791bb`) addressed:
- Cast picker opacity (root cause: inherited `opacity: 0.35` from `.media-result-actions` parent — CSS opacity cascades and can only be broken at an ancestor)
- Per-row action button legibility (was reading as disabled)
- Browse card depth (deeper gradients + persistent amber glow)
- Result peek visual separation (amber left rail)

Follow-up portal fix (`3fa8a01ec`) lifted the cast picker into `document.body` to escape the search overlay's `overflow-y: auto` clip, fully resolving picker visibility regardless of which result row launches it.

### Outstanding follow-ups (out of scope for this overhaul)

1. **Architectural relocation of `LiveStream/`** — move out of `modules/Media/` to a sibling location matching its app boundary (consumed only by `LiveStreamApp` at `/media/channels/*`).
2. **Browse-cards icons** — flat gradient panels would benefit from category-representative icons (music note, film strip, etc.); deferred from design pass.
3. **Visual regression baseline in CI** — current screenshots in `docs/_wip/audits/media-app-screens/` are reference-only; not gated.
4. **Accessibility deep dive** — requirements N6 punted on this in the original spec; remains punted.
5. **Cast picker overlap with peek content** when both are open on the same row — picker positions correctly via portal but visually overlaps the row's expanded peek. Minor cosmetic; user can still interact with the picker.

### One pre-existing bug found and fixed in passing

`ul.media-search-results` inherited `position: absolute` from earlier styles, collapsing the new `.media-search-overlay` wrapper to 2px height — which was the actual cause of Playwright's "pointer interception" failures across the legacy media tests. Fixed by scoping the `ul` to `position: static` inside the overlay (within `9cf6ad582`).
