# Media Player UX Design Audit

**Date:** 2026-03-05
**Scope:** Full media app frontend — player, queue, search, content detail, layout, state machine
**Reference:** [How to Design a Media Player That Users Actually Want to Use](https://think.design/blog/how-to-design-a-media-player/) (think.design, Feb 2026), supplemented by [Vidzflow UX Best Practices](https://www.vidzflow.com/blog/mastering-video-player-controls-ux-best-practices)

---

## Summary

This audit covers **40 usability problems** found through code review, SCSS analysis, and production session logs. The focus is on daily-use impact — broken interactions, confusing semantics, missing feedback, layout jitter, and silent failure modes. Accessibility and caption support are noted but deprioritized.

**Overall Assessment:** Strong architectural bones (three-panel layout, queue system, multi-source search) undermined by conflicting interaction handlers, ambiguous action semantics, missing user feedback, and silent failure modes that leave users staring at a frozen screen with no recourse.

---

## Prioritized Findings

### Tier 1 — Broken (blocks normal use)

#### 1. DASH Stall Recovery Loops Infinitely

**Source:** Production logs `media/logs/media/2026-03-05T18-57-10.jsonl` (post-fix, after `2bc5f45`)

Video (Star Wars Ep I) stalls at ~98.65s. Recovery enters infinite loop — 200+ seek retries over 20 minutes, each seeking ~0.001s backward to the same broken position. 202 `dash.error` events, 199 fragment abandonments, all invisible to the user.

**What the user sees:** Frozen video at 1:38. No spinner. No error. No way to know what's happening. Battery/CPU/bandwidth burned silently. The 30s auto-advance in `MediaApp.jsx` apparently never fires because the recovery keeps the player in "seeking" state.

**Fix:** Seek forward past stall (not backward). Limit retries (3-5 max). After limit, show error overlay with "Skip" and "Retry" buttons. Ensure MediaApp stall detection sees through the seeking state.

**Files:** Recovery logic in Player layer | `MediaApp.jsx:117-157`

---

#### 2. Video Click: Pause vs Fullscreen Conflict

Clicking the video does different things in different modes with no disambiguation:

- **Embedded:** Expands to fullscreen (users expect pause)
- **Fullscreen:** Shows/hides overlay (no way to click-to-pause)
- **Fullscreen progress bar:** Three handlers cascade — `showOverlay()` + `handleSeek()` + wrapper `onPlayerClick`

Production logs confirm: pause/resume flicker (two pauses in 2 seconds, 0.7s apart) likely caused by this conflict.

**Fix:** Single-click = pause/play. Double-click or dedicated button = fullscreen. Fullscreen click on video = toggle overlay. Progress bar `stopPropagation` prevents wrapper handler.

**Files:** `NowPlaying.jsx:177-179,229,258` | `MediaAppPlayer.jsx:82`

---

#### 3. "Play Now" Silently Destroys Queue

Every "Play" button across search, detail view, and child items calls `queue.playNow()` which clears the entire queue before adding the new item. No warning, no confirmation, no undo. A user building a 20-track playlist loses everything with one tap.

Additionally, "Play Now" forces navigation to `/media/play`, ripping the user out of search/browse context.

**Fix:** If queue has items, either confirm ("Replace queue?") or insert-and-skip instead of clearing. Don't auto-navigate — let the MiniPlayer show the change.

**Files:** `SearchHomePanel.jsx:115-122` | `ContentDetailView.jsx:59-69`

---

#### 4. Seek Bar: 4px Tall, Click-Only, Jitters on Interaction

- **No drag-to-seek** — click-only. Every major player supports drag.
- **4px tall** (6px on hover) — 10x below 44px touch minimum
- **Jitters on click:** Hover height snaps (no transition), fill animates horizontally while height changes vertically, time text reflows when digits change width
- **Seek intent leaks:** `isSeeking`/`seekIntent` persist across fullscreen transitions, showing wrong position

**Fix:** Minimum 12px bar + 16px touch padding. Add `onPointerDown/Move/Up` for drag. Add `transition: height 0.15s`. Clear seek state on fullscreen toggle. Fixed-height container for time text.

**Files:** `NowPlaying.jsx:86-94,121-148` | `MediaApp.scss:431-464`

---

#### 5. Child Item Actions Invisible on Touch Devices

Child items (episodes, tracks) in detail view have action buttons at `opacity: 0`, visible only on parent `:hover`. On touch devices, hover doesn't exist. These buttons are **permanently invisible** on mobile and tablet. In grid view, actions are `display: none` — completely removed.

**Fix:** Always visible on mobile (media query). Grid view: show on tap or keep a play button visible.

**Files:** `MediaApp.scss:1400-1412,1478`

---

#### 6. No Volume Control in Fullscreen

Volume slider is hidden when `isFullscreen` is true. No keyboard shortcut, no gesture, no alternative. The primary video watching mode has no volume control.

**Fix:** Add volume to fullscreen overlay. Add Up/Down arrow keyboard shortcuts.

**Files:** `NowPlaying.jsx:291`

---

### Tier 2 — Major UX gaps (frustrating, workarounds exist)

#### 7. Zero Feedback on Queue Actions

"Play Next", "Add to Queue", and "Cast" produce no visual confirmation. User must navigate to queue to verify. Cast picker closes before API response — success and failure both silent.

**Fix:** Toast/snackbar ("Added to queue") with undo option. Cast: show result before closing picker.

**Files:** `SearchHomePanel.jsx:124-138` | `DevicePicker.jsx:15-30`

---

#### 8. Queue Item Touch Interactions Conflict

Three competing handlers on one element: `onClick` (play), `onTouchStart` (swipe-remove), `draggable` (reorder). Small touch movements resolve as clicks instead of swipes. Swipe has no visual feedback (no sliding animation, no red delete zone). Remove button is 26x26px.

**Fix:** Intent detection with dead zone. Swipe animation with delete indicator. Increase remove button to 44px.

**Files:** `QueueItem.jsx:30-54` | `MediaApp.scss:662-672`

---

#### 9. Search Action Buttons Are Untappable

Search result action buttons: 22x22px (14px font + 4px padding). Half the minimum touch target in each dimension. Also undersized: cast button (24px), queue remove (26px), detail toggle (30x28px).

**Fix:** Minimum 36-44px touch targets via increased padding.

**Files:** `MediaApp.scss:940-955,996-1005,1328-1329`

---

#### 10. Continue-Watching Requires 3 Taps to Play

Items in "Continue" section only navigate to detail view. User must: tap → wait for detail load → find play button → tap. Every streaming service plays directly from continue-watching with one tap.

**Fix:** Add inline play button. Single tap plays with resume offset.

**Files:** `SearchHomePanel.jsx:229-266`

---

#### 11. Play/Pause State Machine Has No SSOT

Pause state scattered across NowPlaying (`playbackState.paused`, read-only), Player (`toggle()` imperative), and useCommonMediaController (DOM event listeners). No optimistic update — button shows wrong icon between toggle and next progress callback. Production logs show pause/resume flicker from this.

**Fix:** Optimistic update on toggle. Single state owner. Timeout if toggle doesn't take effect.

**Files:** `NowPlaying.jsx:134-137` | `Player.jsx:734-741`

---

#### 12. Queue Clear: One Tap, No Undo

`queue.clear()` instant, no confirmation, no undo. Clear button has same visual weight as shuffle/repeat — easy to hit by accident.

**Fix:** Confirm dialog or 5s undo snackbar.

**Files:** `QueueDrawer.jsx:25-28`

---

#### 13. Escape Key Destroys Queue Instead of Exiting Fullscreen

The only keyboard listener handles Escape by calling `clear()` — stops playback and empties queue. User watching fullscreen presses Escape (universal "exit fullscreen"), loses entire queue.

**Fix:** Escape exits fullscreen first. Only clear queue if not fullscreen and explicitly intended.

**Files:** `useQueueController.js:199-210`

---

#### 14. Search Results Lack Type/Parent Context

Media app search shows: title + source badge + format badge ("video"/"audio"). Admin's ContentSearchCombobox shows: type-specific icon + "Episode 3 - Breaking Bad" + container chevron + child count. Same API, vastly different information density.

**Fix:** Add `parentTitle`, `itemIndex`, type icon, container indicator. Reuse `TYPE_ICONS` map and `isContainer()` from ContentSearchCombobox.

**Files:** `SearchHomePanel.jsx:196-225` vs `ContentSearchCombobox.jsx:435-501`

---

#### 15. No Keyboard Shortcuts (and No Focus State Machine)

Zero keyboard shortcuts for playback. No spacebar, arrows, M, F, Escape. Other apps in the codebase all have keyboard handlers. Adding shortcuts is blocked by a deeper issue: no focus management (`tabIndex`, `onFocus`, `onBlur` are all absent). Two search inputs would capture spacebar/arrows. Shortcuts must check `document.activeElement` before acting.

**Fix:** Add global keydown handler with `activeElement` guard. Spacebar=toggle, arrows=seek/volume, M=mute, F=fullscreen.

**Files:** `MediaApp.jsx` (none exist) | `SearchHomePanel.jsx:172` | `ContentBrowser.jsx:183`

---

#### 16. Mobile Panel Transitions Are Jarring

Panels switch via `display: none` / `display: flex` — instant, no animation. Feels broken.

**Fix:** CSS transitions (slide or fade, 200-300ms).

**Files:** `MediaApp.scss:22-35`

---

#### 17. Volume Bar Wastes Space, No Mute Button

Full-width horizontal slider consumes its own row (~40px). No mute toggle — must drag to zero.

**Fix:** Vertical slider or inline icon+popout. Speaker icon for mute toggle.

**Files:** `NowPlaying.jsx:291-303` | `MediaApp.scss:507-539`

---

### Tier 3 — Noticeable polish issues

#### 18. Overlay/Icon Sizing Don't Scale

Loading spinner: 10rem fixed (oversized on phone, tiny on TV). Fullscreen transport buttons forced to 24px — **smaller** than embedded mode's 36px primary button. Exit button: fixed 40px. Unicode icons render inconsistently across platforms.

**Fix:** `clamp()` sizing. Keep primary button large in fullscreen. SVG icons.

**Files:** `Player.scss:327-337` | `MediaApp.scss:1044-1047,256-272`

---

#### 19. Fullscreen Transport Buttons Shrink Instead of Grow

Fullscreen override sets ALL buttons to `font-size: 24px`, including primary play/pause which is 36px at 56x56px in embedded. Primary button should be larger in fullscreen, not smaller.

**Fix:** Only override secondary buttons. Keep `--primary` at 36px+ with explicit `width`/`height`.

**Files:** `MediaApp.scss:1044-1047`

---

#### 20. Scrollbar Styling Missing

Queue, search, detail view all have `overflow-y: auto` with no custom scrollbar styling. Default Chrome scrollbar clashes with dark theme. Other apps in codebase all have thin/hidden scrollbars.

**Fix:** `scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;` + webkit overrides.

**Files:** `MediaApp.scss` (zero scrollbar rules)

---

#### 21. MiniPlayer Progress Bar Stutters

Progress div has `transition: width 0.3s linear` but updates at ~4Hz (~250ms). Each update interrupts the previous transition before completion, causing stutter.

**Fix:** Match transition to update interval, or use `requestAnimationFrame` linear interpolation.

**Files:** `MiniPlayer.jsx:47` | `MediaApp.scss:306-313`

---

#### 22. Video Mode Layout Shift via `:has()` Selector

Layout changes from `max-width: 480px; padding: 24px` (audio) to `max-width: 100%; padding: 0` (video) once `.video-player` DOM appears. Visible jump when video loads.

**Fix:** Pre-apply video layout via prop/class on mount, before video element renders.

**Files:** `MediaApp.scss:361-364,153-163`

---

#### 23. Queue Current-Item Border Shifts Content

Current item gets `border-left: 3px solid #1db954`. Other items have no left border. Content shifts 3px when queue advances.

**Fix:** `border-left: 3px solid transparent` on all items.

**Files:** `MediaApp.scss:621`

---

#### 24. Fullscreen Exit Button Propagates to Wrapper

Exit button doesn't `stopPropagation()`. Click fires both `onExitFullscreen` and `onPlayerClick` (showOverlay), starting an overlay timer for a mode being exited.

**Fix:** Add `e.stopPropagation()` to exit button handler.

**Files:** `MediaAppPlayer.jsx:93-99`

---

#### 25. Button Symbol Inconsistency

| Concept | One place | Another |
|---------|-----------|---------|
| Shuffle | `&#8652;` (QueueDrawer) | `&#8645;` (ContentDetailView) |
| Play | `&#9654;` (search) | `▶` (transport) |
| Next | `&#10549;` (search) | `⏭` (transport) |

**Fix:** Standardize on SVG icon set or consistent Unicode subset.

---

#### 26. Fullscreen Preference Persists Incorrectly

`localStorage` key `media:fullscreen` is global. Video fullscreen bleeds into audio. Opening app to browse music → fullscreen player. Not scoped per content-type or session.

**Fix:** Scope to content type. Don't auto-restore on app open.

**Files:** `NowPlaying.jsx:65-67,105-107`

---

#### 27. MiniPlayer PiP Fixed Size, No Controls

PiP mode: 160x90px fixed (50% of 320px phone). Title and play/pause are `display: none` — can't pause from PiP.

**Fix:** Responsive size `min(160px, 40vw)`. Show play/pause overlay on tap.

**Files:** `MediaApp.scss:288-303`

---

#### 28. Overlay Timer Race Conditions

Fullscreen overlay 3s auto-hide timer races with fullscreen toggle. Rapid toggle can leak timers or clear wrong timer. Exiting fullscreen forces `overlayVisible=true` but cleanup clears the timer — batched React updates make order unpredictable.

**Fix:** Mode-aware timer management. Only start timer when entering fullscreen. Clear and reset on every mode transition.

**Files:** `NowPlaying.jsx:69-95`

---

#### 29. Duration Division-by-Zero

`displayTime / playbackState.duration * 100` when duration is 0 → `NaN%`. Progress bar renders `width: NaN%`.

**Fix:** Guard already partially exists (line 170-172) but should be `duration > 0 ? ... : 0`.

**Files:** `NowPlaying.jsx:170-172`

---

#### 30. Double-Click Race on Play Now

ContentDetailView debounces via `playingRef` + 2s `setTimeout`. No cleanup on unmount. SearchHomePanel has NO debounce at all — same action, different surfaces, different protection.

**Fix:** Consistent debounce across all surfaces. Cleanup on unmount.

**Files:** `ContentDetailView.jsx:59-62` | `SearchHomePanel.jsx:115-122`

---

#### 31. Shuffle Algorithm Is Biased

`[...children].sort(() => Math.random() - 0.5)` — well-known antipattern, doesn't produce even distribution.

**Fix:** Fisher-Yates shuffle.

**Files:** `ContentDetailView.jsx:88`

---

#### 32. "Next"/"Queue" Buttons on Non-Playable Containers

Buttons render when `capabilities.includes('playable') || isContainer`. Clicking "Queue" on a TV show queues the container contentId, which may not be playable.

**Fix:** Only show for individually-playable items.

**Files:** `ContentDetailView.jsx:185-189`

---

#### 33. No Queue Position Indicator

No "Track 3 of 12" anywhere. Only visual signal is green highlight on current queue item, which requires scrolling to find.

**Fix:** "3 of 12" near transport controls.

**Files:** `QueueDrawer.jsx` | `NowPlaying.jsx`

---

#### 34. Player Ref Missing Volume/Rate Methods

Imperative handle has `seek`, `play`, `pause`, `toggle`, `advance` — but not `setVolume`/`getVolume`/`setPlaybackRate`. NowPlaying directly manipulates DOM `el.volume`, bypassing transport API.

**Fix:** Add volume/rate methods to imperative handle.

**Files:** `Player.jsx:714-777`

---

#### 35. Grid View Hides All Child Actions

Grid mode: `.child-item-actions { display: none; }`. Users lose play/queue/cast capabilities when switching to grid view, with no indication.

**Fix:** Keep actions visible or show on tap/long-press.

**Files:** `MediaApp.scss:1478`

---

#### 36. Child Items Show Index Without Type Label

Renders "3. The One Where..." instead of "Episode 3 - The One Where..." — ambiguous whether it's a track, episode, or chapter.

**Fix:** Add type label: "Episode 3", "Track 3", etc.

**Files:** `ContentDetailView.jsx:226-228`

---

### Tier 4 — Low priority (edge cases, nice-to-have)

#### 37. Pause/Resume Flicker in Logs

Production: two pauses in 2 seconds (pause → resume 0.7s later → pause 1.1s later). Related to click handler conflict [2]. Will be fixed when [2] is addressed.

---

#### 38. Keyboard shortcuts need focus state machine

Deeper dependency of [15]. Implementing shortcuts requires `activeElement` checking, but also needs `tabIndex` and focus management across three panels. Track as prerequisite for [15].

---

#### 39. Captions/subtitles, playback speed, quality selector

No caption controls, no speed control (0.5x-2x), no quality selector. Standard media player features but not daily-use blockers for current content types.

---

#### 40. Accessibility (ARIA, focus indicators, screen reader)

ARIA labels exist on transport buttons. Missing: visible focus indicators, focus trapping in modals, `aria-live` for track changes, seek bar not a proper `role="slider"`. Important but not prioritized over core usability.

---

## Files Audited

| File | Lines | Role |
|------|-------|------|
| `frontend/src/Apps/MediaApp.jsx` | 223 | App shell, state management, routing |
| `frontend/src/Apps/MediaApp.scss` | ~1481 | All media app styling |
| `frontend/src/modules/Media/NowPlaying.jsx` | 309 | Player view, transport controls, seek, fullscreen |
| `frontend/src/modules/Media/PlayerPanel.jsx` | 63 | Player panel wrapper |
| `frontend/src/modules/Media/MiniPlayer.jsx` | 68 | Compact mobile player bar |
| `frontend/src/modules/Media/QueueDrawer.jsx` | 98 | Queue list with shuffle/repeat/clear |
| `frontend/src/modules/Media/QueueItem.jsx` | 78 | Queue item with click/drag/swipe |
| `frontend/src/modules/Media/SearchHomePanel.jsx` | 287 | Search + continue watching + recent |
| `frontend/src/modules/Media/ContentBrowserPanel.jsx` | 71 | Content browser wrapper |
| `frontend/src/modules/Media/ContentDetailView.jsx` | 257 | Content detail with play/queue actions |
| `frontend/src/modules/Media/ContentBrowser.jsx` | 280 | Search + browse UI |
| `frontend/src/modules/Media/MediaAppPlayer.jsx` | 108 | Player wrapper with fullscreen + resize observer |
| `frontend/src/modules/Media/CastButton.jsx` | 39 | Cast trigger |
| `frontend/src/modules/Media/DevicePicker.jsx` | 69 | Device selection modal |
| `frontend/src/modules/Player/Player.jsx` | ~780 | Core player engine + imperative handle |
| `frontend/src/modules/Player/SinglePlayer.jsx` | ~500 | Single-item player with loading/error |
| `frontend/src/modules/Player/VideoPlayer.jsx` | ~480 | Video-specific player with DASH support |
| `frontend/src/modules/Player/components/ProgressBar.jsx` | 23 | Reusable progress indicator |
| `frontend/src/hooks/media/useMediaQueue.js` | ~230 | Queue state machine |
| `frontend/src/hooks/media/useCommonMediaController.js` | ~1030 | Media element controller |
| `frontend/src/contexts/MediaAppContext.jsx` | - | Queue + player ref context |
| `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx` | 683 | Reference: rich content result rendering |
| Production session logs | - | `media/logs/media/2026-03-05T*.jsonl` via Docker |

---

## References

- [How to Design a Media Player That Users Actually Want to Use](https://think.design/blog/how-to-design-a-media-player/) — think.design (Feb 2026)
- [Mastering Video Player Controls: UX Best Practices](https://www.vidzflow.com/blog/mastering-video-player-controls-ux-best-practices) — Vidzflow
