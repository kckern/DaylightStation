# Unified Content Selector — extract `ContentCombobox` to shared, adopt in Media

**Date:** 2026-07-14
**Status:** In progress — Part A (extraction) DONE & green; Part B (Media adopt) pending

## Progress log
- **Source reconciled:** homeserver deploy tree (62 commits ahead, incl. the media UX
  overhaul) fast-forwarded into local `main`; `feature/ir-blaster` merged into `main`.
  **Both await `git push origin main` (user-run; classifier blocks the assistant).**
- **Part A DONE:** `ContentCombobox` subsystem extracted to `frontend/src/modules/Content/`
  (`combobox/` + `lib/`), decoupled from Admin via `Content/combobox/notify.js`.
  11 Admin importers swept. **319 tests green across 25 files**; old-path grep clean.
- **Dispatch seam mapped:** cast/device dispatch = `useDispatch().dispatchToTarget({ targetIds,
  play, mode:'fork', title })` (in `cast/DispatchProvider.jsx`). Local = `queue.playNow` on
  `useSessionController('local')`. Global `SearchBar` (in `Dock`) currently hardcodes local.
- **OPEN — target routing:** the selector emits one id; the consumer must route it. Recommended
  default: **route by active view** — in `peek(deviceId)` → `dispatchToTarget([deviceId], 'fork')`;
  else local `playNow`. Makes the office-tv journey work end-to-end.

**Origin:** Stranger Things browse-journey failure on `daylightlocal.kckern.net/media?view=peek&deviceId=office-tv`

---

## Problem

Searching a **show** from Media search and trying to pick *the episode you're on* fails.
Selecting "Stranger Things" fires `Play Now` on the show container `plex:663745`, which the
backend resolves to **S01E01** (`plex:663777`) and expands into a 42-item queue from the top.
There is no step to browse seasons/episodes and pick your own — a show is treated as a
playable leaf.

Confirmed in prod logs (2026-07-14 ~21:03): `dispatch.initiated contentId=plex:663745 mode=fork`
→ `prewarm.success plex:663745 → plex:663777` → `playback.started "Chapter One"`.

## Root cause

Two content-picker implementations evolved in parallel and were never unified:

| | Search+browse | Terminal action | Home |
|---|---|---|---|
| **`ContentCombobox`** | ✅ SSE multi-source search **and** drill-into-container browse (breadcrumbs, `goUp`/`goToCrumb`, ArrowRight-drill, scroll-edge pagination) | single commit `onChange(id, item)` | `Admin/ContentLists/combobox/` |
| **Media `SearchBar`** | ❌ flat result list, **no drill** | per-row queue ops (Play Now/Next/Up Next/Add/Cast) via `useSessionController('local')` | `Media/search/` |

The combobox has the browse capability Media needs but lives in Admin and only commits an id.
Media's search has the dispatch/queue actions but can't browse. Nobody merged them.

## Architecture — the selector/consumer boundary

**Key principle (KC, 2026-07-14):** *the combobox is a selector, not a dispatcher.* Its job ends
at `onChange(contentId, item)`. What happens to the selection — auto-dispatch to a device,
queue it, commit it into a config form — is the **consuming context's** concern. No device or
playback knowledge enters the combobox. The single-commit `onChange` is the correct seam, not a
limitation.

```
┌─────────────────────────────┐        onChange(id, item)        ┌──────────────────────────┐
│   ContentCombobox (shared)  │ ───────────────────────────────▶ │   Consumer decides        │
│   search + browse/drill     │                                  │  • Media: auto-dispatch   │
│   emits ONE selected id     │                                  │    to active device       │
│   knows nothing downstream  │                                  │  • Admin: commit to form  │
└─────────────────────────────┘                                  └──────────────────────────┘
```

## Locked decisions

1. **Terminal action in Media = single dispatch.** Picking an episode dispatches it to the active
   device and closes. (Not a per-row action set — that would push player concerns into the selector.)
2. **Media adopts by replacement.** The shared combobox *replaces* `SearchBar` /
   `SearchProvider` / `useLiveSearch` / `SearchResults` / `ResultRow`. One search+browse surface.
3. **Queue actions (Play Next / Up Next / Add) are dropped for now.** They become a possible
   later consumer-side layer (e.g. a post-selection action menu), not a combobox feature.

## Work — two parts

### Part A: Extract `ContentCombobox` to a shared home

It's a **subsystem**, not a file. Moves together:

- `combobox/` dir: `ContentCombobox.jsx` + `.scss`, `comboboxMachine.js`, `useContentCombobox.js`,
  `useAutoResolve.js`, tests.
- ContentLists helpers it imports: `contentSearchLogic.js`, `siblingsCache.js`, `breadcrumbs.js`,
  `comboboxScroll.js`.

Already global (no move): `hooks/useStreamingSearch`, `lib/logging`.

**Decouple from Admin:**
- `Admin/shared/feedback.js` (`showUndoToast`, `notifyWarning`) — inject via prop or move the
  generic toast helpers to a shared util. The selector should not import Admin-scoped feedback.
- `.scss` "admin color scope" note + `app:'admin'` log tag — make the log `app`/scope a prop or
  neutral default.

**Home:** repo has no `_Common`; convention is per-domain `{Domain}/shared/` + global `lib/`+`hooks/`.
Proposed: new `frontend/src/modules/Content/` (or `_Common/`) module holding the selector subsystem.
**11 Admin call-sites** import `ContentCombobox` (ContentLists, PlaybackHub, TestHarness, Apps) —
path-sweep only, no behavior change. Admin keeps passing its own `onChange` (commit-to-form).

### Part B: Media adopts the selector

- Replace `SearchBar`'s flat-list body with `<ContentCombobox>` (keep the scope `<select>` →
  pass through as `searchParams`/`selectContainers`).
- `onChange(id)` → call Media's existing dispatch seam. Today `SearchBar` uses
  `useSessionController(...).queue.playNow({ contentId }, { clearRest: true })`; the peek flow
  targets a device (`deviceId=office-tv`). Wire `onChange` to that same dispatch, resolving the
  active/target device.
- Delete `SearchProvider`, `useLiveSearch`, `SearchResults`, `ResultRow`, `resultToQueueInput`,
  `searchStates`, related state files + tests once the combobox covers their behavior.

## ⛔ CRUX BLOCKER FOUND — backend season-as-show wrapping (verified live 2026-07-14)

Verified against prod: `/api/v1/list/plex/663745` (show) → 5 seasons ✅, but
`/api/v1/list/plex/663746` (Season 4) → **1 self-referential container tile, NOT its 9 episodes**.
Root cause is deliberate: **`backend/src/4_api/v1/routers/list.mjs:558-588` "Season-as-show
wrapping"** (and `:532-556` playlist-as-show) — the adapter returns the real episodes (line
~468-477) and then they are **overwritten** with a single show-tile, so a season/playlist appears
as one tile in **FitnessMenu**. Consequence: drilling a season dead-ends everywhere — the existing
Browse tab AND the future combobox. **No selector wiring fixes this; the backend must change.**

**Required fix (bounded):** gate the season/playlist wrapping behind a modifier.
- Backend: only wrap when the caller opts in (FitnessMenu passes the flag); default `/list` of a
  season returns its episodes. `modifiers` already parsed (`parseModifiers`, cf. `modifiers.playable`
  at :592) — add e.g. `tiles`/`menu` opt-in, or a browse opt-out `expand`. Verify FitnessMenu
  callers keep the tile. TDD.
- Frontend: combobox `drill` (`useContentCombobox.js` → `/api/v1/list/...`) and `BrowseView`
  pass the browse/expand modifier.

### Original risk (now RESOLVED by the above)
- ~~Plex show → season → episode drill~~ — proven: show→seasons works, season→episodes blocked by
  the wrapping above.
- **Dispatch seam.** Confirm exactly how a picked id reaches the *targeted* device in peek mode
  (`useSessionController(deviceId)` vs fleet dispatch) so `onChange` hits the right controller.
- **Admin regression surface.** 11 call-sites + Playwright specs (18/19) pin the combobox; the
  extraction must keep them green.

## Deferred (not in scope now)

- **On-deck / resume highlight.** The original wish ("resume the episode I'm on") is *partly*
  solved by browse (you can drill to S3/4/5 and pick). A visible on-deck marker + resume-offset
  dispatch is a follow-up enhancement.
- **Consumer-side queue actions** (Play Next / Up Next / Add) as a post-selection menu.

## Testing

- Reuse combobox unit + machine tests after the move (path updates).
- New Media flow test: search show → drill to a deep episode → select → assert dispatch of the
  *episode* id (not S01E01) to the target device.
- Keep Admin Playwright specs green through the extraction.
