# WeeklyReview Module — Comprehensive UX & Best-Practice Audit

**Date:** 2026-05-03
**Reporter:** User-reported (UX is "D-")
**Severity:** P0 — feature ships and saves audio, but the UI is broken (dead arrow keys, invisible level meter) and most of the surrounding code violates project conventions
**Scope:** `frontend/src/modules/WeeklyReview/` — `WeeklyReview.jsx`, `WeeklyReview.scss`, `components/{DayColumn,DayDetail,FullscreenImage,PreFlightOverlay,PhotoWall,RecordingBar}.jsx`, `hooks/{useAudioRecorder.js,useChunkUploader.js,chunkDb.js}`

---

## TL;DR

WeeklyReview was built feature-by-feature ("Task 8 viewLevel state machine", "Task 16 preflight overlay", "Task 18 fixed-width", "Task 19 focus indicator") with no integration pass at the end. Each task added state, CSS, and overlays without re-checking what came before. The result:

| User reports | Root cause |
|---|---|
| **"arrow keys do nothing"** | Keydown listener attached to a `tabIndex={0}` `<div>` (P0-1). Any click moves focus to a child that isn't focusable, focus drops to `<body>`, and arrow events stop reaching the listener. There is no document-level fallback. |
| **"audio input bar isn't showing"** | A second `.vu-meter` rule in the SCSS (line 1166) overrides `display: flex` with `display: inline-block` (P0-2). The `.vu-bar` children stop laying out horizontally, the meter collapses, and Task 18's "tabular-nums everywhere" pass clobbered Task 11's flex layout. |
| **"the whole UX is D-"** | 18 `useState`s in one 740-line component, 6 different overlay flags managed independently, mixed mouse vs keyboard idioms, conflicting focus styles, no a11y, no focus trap, two competing primary CTAs ("Stop" + "Save Recording"), confusing keymap (Enter = upload, ArrowUp at TOC = exit, Backspace = Escape, Space = Enter). Detailed below. |

Three independent P0s, ten P1s, and forty-something P2s. The shape of the bug list is "Tasks 8 → 19 each landed cleanly; nothing that came after was rechecked against what came before."

---

## P0 — Outright Failures (block users)

### P0-1 — Arrow keys silently die after the first interaction

**Path:** `WeeklyReview.jsx:339-540`

```jsx
const containerRef = useRef(null);
// ...
useEffect(() => {
  const handleKeyDown = (e) => { /* ~190 lines of switch logic */ };
  const container = containerRef.current;
  if (container) {
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }
}, [data, viewLevel, dayIndex, imageIndex, focusRow, resumeDraft, finalizeError,
    showStopConfirm, preflightStatus, preflightFocus, confirmFocus, errorFocus,
    disconnectModal, finalizePriorDraft, onExitWidget, onSaveAndExit,
    onEnterUpload, onPreflightRetry, onPreflightExit, onBackPressed]);
// ...
useEffect(() => { containerRef.current?.focus(); }, [loading]);   // fires once
// ...
return (
  <div className="weekly-review" ref={containerRef} tabIndex={0}>
    {/* ... */}
    <DayColumn onClick={() => { setDayIndex(i); setViewLevel('day'); }} />
    <button onClick={onSave} ... />
  </div>
);
```

**Why it fails.** The handler is bound to `containerRef.current` and only runs while focus is inside the container. The component:

1. Auto-focuses the container exactly **once**, on the `loading → false` transition.
2. Renders `<div className="day-column" onClick=…>` cells with no `tabIndex`. Clicking one moves focus to `<body>`.
3. Renders multiple `<button>`s in the recording bar — clicking those steals focus too.
4. Has no `onFocus`/blur handler that puts focus back onto the container.
5. Has no document-level fallback listener.

After the first mouse interaction, arrow events fire on `document.body`, bubble up to `document`, and never reach the listener that lives on the container `<div>`. The user sees a frozen UI.

**Compounding it:**
- `outline: none` on `.weekly-review` (line 9) means there is **no visual indicator** that focus was lost — the user has no way to tell why arrows stopped working.
- The dependency array has 18 entries. The listener detaches and reattaches on virtually every state change, including 20×/sec when `micLevel` causes parent re-renders that cascade. (It's not in the deps directly but parent re-renders rebuild the closures it captures, and many of those closures *are* in the deps.) Wasteful at minimum.
- Capture phase isn't used, so a single `e.stopPropagation()` anywhere upstream (screen-framework, MenuNavigationContext) silently kills arrow handling.

**Fix.** Move the listener to `document` (or `window`) for as long as the widget is mounted; gate behavior with a "is this widget the active screen" predicate. Or, make every focusable child handle arrows via a roving-tabindex pattern. Either way: **never rely on a container `<div>` keeping focus** as the sole input mechanism.

---

### P0-2 — VU meter is invisible because two SCSS rules collide

**Path:** `WeeklyReview.scss:453-458` and `WeeklyReview.scss:1166-1170`

```scss
// First rule (Task 11-ish)
.vu-meter {
  display: flex;
  gap: 2px;
  align-items: center;
  height: 20px;
}

// ...700 lines later, "Task 18: Fixed-width treatment for dynamic text"
.vu-meter {
  display: inline-block;   // ← overrides the flex above
  width: 8rem;
  flex-shrink: 0;
}
```

The cascade resolves `display` to `inline-block`. The 20 child `.vu-bar` divs are block-level by default; inside an `inline-block` parent they **stack vertically**, not horizontally. Each is `width: 4px; height: 100%` (= 20px), so the column collapses to a 4px-wide vertical strip — visually nothing.

This regression came from Task 18's well-intentioned "kill jitter from variable-width readouts" pass: it dropped a stub rule for `.vu-meter` to anchor its width without realizing the rest of the meter's layout depended on `display: flex`. Same risk exists for `.recording-timer`, `.fullscreen-image-index`, `.mic-indicator`, `.sync-badge`, `.upload-flash`, `.existing-badge`, all of which got later overrides without checking earlier rules.

**Fix.** Either delete the duplicate Task 18 block and put a `min-width: 8rem` directly on the original rule, or change the duplicate to only set the properties it owns (no `display` redeclaration).

---

### P0-3 — UX is undermined by two competing primary CTAs and a non-obvious "Enter = upload"

**Path:** `RecordingBar.jsx:73-93` + `WeeklyReview.jsx:425-431`

```jsx
{uploading ? <Transcribing/> : isRecording
  ? <button className="recording-stop-btn" onClick={onStop}>■ Stop</button>
  : <button className="recording-start-btn" onClick={onStart}>● Record</button>}

<button className={`recording-bar__save ${isFocused?'focused':''} ${canSave?'can-save':''}`}
        onClick={onSave} disabled={!canSave}>
  ■ Save Recording
</button>
```

While recording, the bottom bar shows BOTH **■ Stop** (a small grey button) and **■ Save Recording** (a large green pulsing yellow-ringed button). What's the difference?

- Looking at the handlers: `onStop` → `setShowStopConfirm(true)` (open a modal). `onSave` → `stopRecording()` (also stops). The modal asks "Save & Close" or "Continue Recording", which then also stops.
- Net: there are **three** ways to end the recording (Stop button, Save Recording button, save-confirm modal), and the difference is opaque to the user.
- The big pulsing yellow button (`save-pulse`, 2.5s cycle, `box-shadow: 0 0 24px 8px rgba(255,235,59,0.6)`) is **always animating** during a meditative weekly review — the visual equivalent of a pop-up at a yoga class.

Meanwhile, **Enter at the top-level grid does NOT enter a day** (which is what every keyboard user expects). Enter is hijacked at line 425-431 to mean "upload finalize while still recording":

```jsx
if (isEnter) {
  e.preventDefault();
  e.stopPropagation();
  onEnterUpload();   // POSTs /finalize; recording continues
  return;
}
```

So the user navigating with arrows-and-Enter (the universal arcade idiom this app uses everywhere else) will mash Enter on a day they want to inspect and instead trigger an opaque server upload. There is **no** keyboard equivalent of clicking a day column to enter day view — the click handler fires `setDayIndex(i); setViewLevel('day')` (line 638) but no key invokes that path.

To make it worse, ArrowLeft/ArrowRight at TOC level **also** jumps to day view (lines 513-526), so the TOC view is unreachable by keyboard once data loads (the auto-set `dayIndex = lastDayWithContent` puts you in 'toc' state, but moving sideways instantly leaves it).

**Fix.** Decide what "Enter" means and stick to it. Standard idiom: Enter = activate focused item (open day, open photo, click button). Add an explicit "Upload now" affordance instead of overloading Enter. Remove the duplicate Stop/Save buttons from the bar — keep one. Kill `save-pulse`.

---

## P1 — Major Best-Practice Violations

### P1-1 — Six independent overlays, six independent focus indices, no central modal manager

**Path:** `WeeklyReview.jsx:23-40`

```jsx
const [showStopConfirm, setShowStopConfirm] = useState(false);
const [confirmFocus, setConfirmFocus] = useState(0);
const [resumeDraft, setResumeDraft] = useState(null);
const [finalizeError, setFinalizeError] = useState(null);
const [errorFocus, setErrorFocus] = useState(0);
const [disconnectModal, setDisconnectModal] = useState(null);
const [preflightFailed, setPreflightFailed] = useState(false);
const [preflightFocus, setPreflightFocus] = useState(0);
```

The keyboard handler then has six top-level `if (overlayFlag)` branches with hand-rolled L/R focus toggling and Enter activation, in priority order, where each branch must remember to `e.preventDefault()` and `return` (lines 348-412). This pattern is bug-prone — order changes silently change overlay precedence; adding a 7th overlay requires touching the keyhandler, the JSX, and inventing a new focus index.

**Fix.** One `currentModal: { type, focusIndex }` state. One render switch. One key handler that reads `currentModal.type` and dispatches.

### P1-2 — 4-tuple view state should be a state machine, not 4 independent useStates

**Path:** `WeeklyReview.jsx:32-40`

```jsx
const [viewLevel, setViewLevel] = useState('toc');
const [dayIndex, setDayIndex] = useState(0);
const [imageIndex, setImageIndex] = useState(0);
const [focusRow, setFocusRow] = useState('main');
```

The component then has to keep them in sync manually:
- L519: `setDayIndex(dayIndex - 1); setViewLevel('day');` (TOC → day, two updates)
- L484-487: `setImageIndex(0); setViewLevel('fullscreen');` (day → fullscreen, two updates)
- L460-462: ArrowLeft in fullscreen does `setDayIndex(dayIndex-1); setImageIndex(0); setViewLevel('day');` (three updates)

These are batched in React 18 inside event handlers, so the UI doesn't tear. But the *logic* is duplicated everywhere transitions happen, and an off-by-one slip in any handler corrupts the view. Use `useReducer` with explicit `{type:'SELECT_DAY',index}`, `{type:'OPEN_PHOTO',index}`, etc.

### P1-3 — Keymap violates universal navigation conventions

`WeeklyReview.jsx:339-528`

| Key | Where | What it does | What users expect |
|---|---|---|---|
| `Enter` | TOC | Upload finalize | Open the focused day |
| `Space` | anywhere | Same as Enter | Page down / pause |
| `Backspace` | anywhere | Escape | Delete |
| `ArrowUp` | TOC | **Exit the entire widget** | Move focus up / scroll |
| `ArrowDown` | TOC | Focus the bottom bar | Move focus down |
| `ArrowDown` (twice) | TOC | Exit widget (because second ArrowDown from `focusRow=bar` exits) | n/a |
| `ArrowLeft`/`Right` | TOC | Jump into day view (skipping any TOC selection) | Move sideways within TOC |
| `ArrowUp`/`Down` | fullscreen | Cycle photos | Move within image (zoom?) |
| `ArrowLeft`/`Right` | fullscreen | Jump to a different day | Previous/next photo |

The `ArrowLeft`/`Right` semantics in **fullscreen** are reversed from intuition: the visually adjacent action (previous/next photo) is bound to ArrowUp/Down, while ArrowLeft/Right teleports the user to a sibling day's day-view. Nobody discovers that without reading the source.

`Space === Enter` and `Backspace === Escape` are also dangerous in any future context where an input field is added (Backspace in a textarea would no longer delete characters — it would unmount).

### P1-4 — DayColumn isn't keyboard-reachable

`DayColumn.jsx:32-37`

```jsx
<div className={columnClass} style={{ flex: day.columnWeight }} onClick={onClick}>
```

No `role="button"`, no `tabIndex`, no `onKeyDown`. Mouse-only. Screen readers read it as a generic group. The `--focused` className flips when arrow keys move the index, but only because the parent rerenders — focus never leaves the (invisible) container.

### P1-5 — `outline: none` on the focus host with no replacement

`WeeklyReview.scss:9`

```scss
.weekly-review {
  outline: none;
}
```

`.weekly-review` is the *only* focusable element in the tree. Removing its outline removes the user's last cue that focus is somewhere they can't see. The MDN guidance is unambiguous: never strip outlines without a `:focus-visible` replacement.

### P1-6 — Hover and focus styles are conflated

`WeeklyReview.scss:128-144`

```scss
&--continue {
  &:hover, &.focused {
    background: #4a6a4a;
    outline: 3px solid #aaffaa;
  }
}
```

A mouseover renders the same outline as keyboard focus. After a click, the lingering hover styling ("did I focus it?") is indistinguishable from real focus. Use `:focus-visible`, not `.focused`-as-state-class for the hover case.

### P1-7 — No focus-trap or `aria-modal` on overlays

`WeeklyReview.jsx:601-701`, `PreFlightOverlay.jsx:14-44`

The confirm/resume/error/disconnect/preflight overlays render at z-index 50–60 over the grid. None of them:
- Sets `role="dialog"` / `aria-modal="true"`
- Traps Tab inside the dialog
- Restores focus to the launcher on close
- Labels the dialog content with `aria-labelledby` / `aria-describedby`

Any keyboard user with default browser behaviour can tab "out" of the modal into now-invisible underlying buttons. With current focus management (P0-1), this is academic — but the moment focus is fixed, it becomes reachable broken-ness.

### P1-8 — Z-index ordering is wrong for the modal stack

`WeeklyReview.scss:27,88,1036,1078,937`

```scss
.weekly-review-init-overlay        { z-index: 50; }
.weekly-review-confirm-overlay     { z-index: 60; }
.weekly-review-preflight-overlay   { z-index: 50; }
.weekly-review-fullscreen-image    { z-index: 30; }
.mini-video-overlay                { z-index: 100; }
```

Preflight is the most blocking modal (no input is permitted). It should stack above the finalize-error / stop-confirm / disconnect modals. Currently `.confirm-overlay` (60) renders **above** `.preflight-overlay` (50). The keyhandler gates this in code (preflight branch fires first), so today nobody sees a stop-confirm during preflight — but the CSS doesn't reinforce the invariant. A future code change that renders the confirm during preflight would draw confirm on top of preflight without complaint.

### P1-9 — VU meter is React state updated 20×/sec

`useAudioRecorder.js:152-155`

```jsx
if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {  // 50ms
  lastLevelAtRef.current = now;
  setMicLevel(normalized);
  // ...
}
```

`setMicLevel` causes a top-level re-render of `WeeklyReview` (which holds the state via destructure) 20×/sec. That re-renders DayColumn × 7, the entire grid, and reattaches the keydown listener at the top of the file because `onChunk` (a useCallback) gets a fresh closure. None of these renders depend on the level. The level meter should use a ref + direct DOM update (or a small leaf component subscribing to a level event source). The current code is the exact pattern the React docs warn against.

### P1-10 — Microphone constraints don't request voice processing

`useAudioRecorder.js:193`

```jsx
stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

For voice journaling on a TV across the room, users *want* echo cancellation and noise suppression. Browsers default these to off when passing `audio: true` rather than an object. Should be:

```jsx
{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
```

And if there's a household preference for raw audio, surface it explicitly.

---

## P2 — Smaller Best-Practice Violations (sorted by category)

### Layout / CSS

1. **Universal selector applies `font-variant-numeric` and `font-feature-settings: 'tnum'` to every node** under `.weekly-review` (lines 1131-1135). Affects emoji, ligatures, icon fonts, and forces a paint property on every text node. Apply it to specific readouts only.
2. **Hard-coded `repeat(4, 1fr)` × `repeat(2, 1fr)` grid** (line 151) for a 7-day week leaves an 8th empty cell. Should be `repeat(7, 1fr)` × `1fr`, or use auto-fill with min content.
3. **`min-width: 60px`** on `.day-column` (line 166) is too small for any meaningful content; columns squeeze when calendar text is long.
4. **`day-column--today` is an empty rule** (lines 174-175). Dead CSS.
5. **`flex: ${day.columnWeight}` inline-styled** (DayColumn.jsx:35). If `columnWeight` is undefined the resolved style is `flex: undefined` (CSS treats it as the initial value, but it's still wrong). Add a guard.
6. **`background: inherit` on `.day-detail-photo::before`** (line 853) — `inherit` resolves to the longhand only on `background-image`, not on the shorthand. Background blur effect probably works in Chrome's relaxed mode but is undefined.
7. **`data-count` adaptive grid only handles 1-6 explicitly** (lines 818-833). 7 photos look unrelated to 6.
8. **No responsive breakpoints anywhere.**
9. **`.day-detail-photos` always uses `grid-auto-rows: 1fr`** but `.day-detail-gallery` flex-grows on Y. With many photos the grid shrinks below thumbnail size.
10. **No `prefers-reduced-motion` guard** for the four infinite animations (`pulse` recording dot, `mic-pulse`, `mic-lost-flash`, `save-pulse`).
11. **`.fullscreen-image-overlay` uses `flex-direction: row` and `justify-content: space-between`** with three children (day label, index, people). The middle child can't be centered — at narrow widths the index visually merges with whichever neighbor wins the alignment.
12. **`.day-detail-photo`** sets `style={{ backgroundImage }}` AND renders `<img>` over it (DayDetail.jsx:301-307). Two image fetches per photo.
13. **Plex thumb URL has `Date.now()` cache buster** (DayDetail.jsx:11). Every bootstrap re-downloads every thumbnail.
14. **WMO_ICONS table duplicated** between `DayColumn.jsx:4-12` and `DayDetail.jsx:16-24`. Same for WMO_DESC and `cToF`.
15. **`parseLocalTime`, `formatTime12`, `to24h`, `cToF`, `plural`, `formatTime` (RecordingBar)** all duplicated inline. No `lib/util/time.js`.

### Accessibility (WCAG)

16. **`alt=""` on all images** (DayColumn / DayDetail / FullscreenImage / PhotoWall). Decorative-only is wrong for fullscreen content; should describe the photo or at least date/people.
17. **No ARIA roles** — `role="dialog"` missing on confirm/resume/error/disconnect/preflight overlays; `role="grid"` on the TOC; `role="button"` on DayColumn.
18. **No `aria-live` regions** on the VU meter, mic indicator, sync badge, recording timer. Screen readers get nothing about state changes.
19. **No labels on buttons that contain only an icon** — `■ Stop`, `● Record`, `▶` video play, `✕` mini-video close. Add `aria-label`.
20. **Color contrast for `#888` on `#1a1a1a`** is 4.0:1 (fails AA for large text without weight). `#666` on `#222` is below 3:1.
21. **`disabled={!canSave}` on Save button** has no `aria-disabled` mirror; some assistive tech relies on the latter.
22. **No skip-link or landmark roles** to let a user jump past the grid into the bar.

### Functional

23. **`autoStartRef` race** (line 184): if `data` arrives, recording starts. If the user dismisses preflight retry → cleanup-then-start in 100ms (line 123) doesn't await the cleanup. Two recorders can briefly coexist.
24. **`finalizePriorDraft` base64-encodes blobs and POSTs JSON** (lines 281-296). 33% wire-size inflation, plus all chunks held in memory at once. Use `multipart/form-data` or raw blob upload.
25. **`estimatedDuration = Math.round(totalBytes / 3000)`** (line 308) — guesses duration from byte count assuming 24 kbps Opus. Wrong for any non-default codec; should be omitted (server can compute).
26. **Bootstrap refetch after finalize** (line 315) without abort signal. Race during unmount.
27. **`recorder.onstop` and reconnect's `onstop` both call `cleanup()`** (lines 238-244, 319-325). After reconnect the old recorder's onstop fires when its stream tracks end; that calls `cleanup()` and tears down the reconnected stream too.
28. **`audioContextRef.current = stream._bridgeCtx || new AudioContext()`** (line 125). When bridge isn't used, a fresh context is created but cleanup only closes `_bridgeCtx`. The orphan context leaks (they're capped at ~6 per origin in Chrome).
29. **No timeout on `/finalize`** — server stall = WeeklyReview spinner forever.
30. **`setupRetryInterval`** in `pause`/visibility change is missing entirely. If the user backgrounds the tab during a flaky network, drains stop firing until manual recovery.
31. **`recorder.start(CHUNK_INTERVAL_MS)` = 5s chunks** (line 249). Final < 5s of audio is captured only by `requestData()` at stop, which isn't guaranteed across browsers (it's a shim). For a closing-thought "and that's the week", that's the most important 3 seconds.
32. **`MediaRecorder({ mimeType: 'audio/webm' })`** — no `MediaRecorder.isTypeSupported` check. iOS Safari and FKB browser builds without webm support throw on construction.
33. **WebSocket bridge URL hard-coded** to `ws://localhost:8765` (line 15). Won't work on any device that isn't talking to its own bridge.
34. **`ws.onmessage` is reassigned** during connect, then again in `buildBridgeStream`. The original handler that parsed the format header is silently dropped on the way to the binary-data path; if the bridge ever emits another text frame mid-stream it goes to the worklet path and crashes the worklet.
35. **AudioWorklet processor source is a 25-line template string with sample-rate substitution** (lines 40-65). Should be a separate file imported via `?worker` or `?url` — the inlined string blocks bundler analysis and minification.
36. **`requestAnimationFrame` for level sampling** (line 169) ties sampling rate to display refresh and pauses entirely when the tab is hidden (rAF doesn't fire). `setInterval(sample, 50)` is the right tool here.
37. **MiniVideoPlayer creates a `mediaTransportAdapter` it never uses** (DayDetail.jsx:62). Dead.
38. **MiniVideoPlayer's first effect has `[src]` deps but recreates the transport without disposing the previous one** (DayDetail.jsx:61-65). Leak when src changes.
39. **`activeVideo` uses `photo.original`** directly (line 206) — no transcoding adapter, no streaming endpoint. Large videos download in full before playing.

### State / React

40. **18 `useState`s in one component** (lines 18-40). Should be at most 3-4 with reducers/grouping.
41. **`uploading` state is dead code** (line 22) — the `// eslint-disable-next-line no-unused-vars` comment admits it. Remove it.
42. **3 separate `useEffect`s for logging state changes** (lines 141-154). Collapse or remove; logger calls inline at the relevant `setX` sites are clearer.
43. **`React.useContext`** (line 44) instead of named `useContext` import. Inconsistent.
44. **`logger` initialised at module scope** (line 15). For consistency with the project's lazy-logger feedback rule (see `frontend/src/modules/Feed/Scroll/feedLog.js`), wrap in a getter.
45. **Inline arrow functions in JSX** at lines 658, 706-712, 726-727, 733-736 — recreate every render, defeat downstream memoization. Hoist into `useCallback` or accept the cost only if memoization isn't expected.
46. **`key={i}` on lists in DayColumn (line 53), DayDetail timeline (line 250), confirm-actions** — fragile if items reorder. Use stable IDs.
47. **No PropTypes / TS types** anywhere in the module.
48. **Inline IIFE in JSX** (lines 616-622) — extract `<DayFullscreen day={...} index={...} />`.
49. **Pop-guard duplicates view-level state via three refs** (lines 544-549) so it can read latest values inside the closure. A single `useEffect` with proper deps would do, or move the pop-guard into the same reducer that owns view state.

### Architecture / Layering

50. **740-line component does everything**: bootstrap fetch, recording orchestration, key navigation, modal management, draft recovery, beacon flush, focus management, layout, render. Should split: `useWeeklyReviewBootstrap`, `useRecordingPipeline`, `useViewNavigation`, `<WeeklyReviewView>`.
51. **Direct `DaylightAPI` calls** instead of going through a domain service. Mirrors the project's "API layer plex coupling" audits — this module is at the API layer with no domain in front.
52. **`hooks/AUDIO-BRIDGE-MIGRATION.md` is in the source tree** alongside hooks. Move to `docs/_wip/` or the runbook directory.
53. **`hooks/useAudioRecorder.test.js`** is colocated with the hook but the rest of the project keeps tests under `tests/`. Either move it or codify colocation as the new convention.
54. **No domain/system separation**: paths like `/api/v1/weekly-review/recording/chunk` are typed inline in three places (uploader, finalize-prior-draft, beacon). Extract a `recordingApi.mjs`.
55. **`chunkDb.js` uses raw IndexedDB** (~130 lines) when `idb-keyval` or even a lightweight wrapper exists in the rest of the project. Reinventing storage at this layer is worth questioning.
56. **No error boundary** above WeeklyReview. A throw in DayDetail crashes the whole module and probably the parent screen.

### Performance

57. **`vuBars` array of 20 booleans recomputed every 50ms** via `useMemo` (RecordingBar.jsx:29-33). Cheap but unnecessary; render based on a numeric width style instead of 20 elements.
58. **`micLevel` re-renders `WeeklyReview` 20×/sec** (P1-9) and propagates to all children that don't memoize.
59. **Photos lazy-load (`loading="lazy"`)** but they're inside grids that fill the viewport — laziness doesn't help for visible content; it does help for the scroll-to-bottom day-detail gallery, OK.
60. **Dropdown of all photos in a grid** with `<img>` for original-size and `background-image` for blur (DayDetail). Two fetches, no `srcset`.

### Project-Convention Violations (per `CLAUDE.md`)

61. **Per `CLAUDE.md`**: "Always use the logging framework — never use raw `console.log/debug/warn/error`". The module compliantly uses `getLogger`. ✓ (only positive note in this section.)
62. **Per `CLAUDE.md`**: "When building new components … add structured log events at key lifecycle points from the start". Most events are present. But `disconnectModal` phase changes are not logged separately, and the keyboard handler logs nothing about why a key was swallowed — making remote debugging the user's "arrow keys don't work" report nearly impossible.
63. **Per `CLAUDE.md`**: "Prefer editing existing files to creating new ones". This module created new files for everything (which is fine per-feature). But cross-feature utilities (WMO icons, time formatters) were re-created inside the module rather than added to a shared util.
64. **Per `MEMORY.md` feedback**: "Reference docs are endstate, not status". `hooks/AUDIO-BRIDGE-MIGRATION.md` is a status doc inside the source tree.
65. **Per `MEMORY.md` feedback**: "Verify test helpers before prescribing". `useAudioRecorder.test.js` exists but I did not verify it runs against the current implementation; the file is dated April 26 and the recorder was edited the same day — likely OK, but worth re-running.

---

## Suggested Fix Order

The cheapest fixes that produce the biggest UX deltas, in order:

1. **Fix VU meter** (P0-2) — delete the duplicate `.vu-meter { display: inline-block }` rule. 5-line change.
2. **Move keydown listener to document** (P0-1) — gate it on a "this widget is the active screen" check from MenuNavigationContext. Add `:focus-visible` styling so the user always sees where focus is. ~30-line change.
3. **Decide what Enter does** (P0-3) — pick one: Enter activates the focused item OR Enter uploads. Don't do both. Remove the Stop button or the Save Recording button; keep one. Remove `save-pulse`. ~50-line change.
4. **Consolidate modal state** (P1-1) — one `currentModal` reducer; one render switch. Buys you the focus-trap and ARIA upgrade as a side effect.
5. **Reducer-ify view state** (P1-2) — `{viewLevel, dayIndex, imageIndex, focusRow}` becomes a single state machine.
6. **Sane keymap** (P1-3) — drop `Space === Enter`; drop `Backspace === Escape`; ArrowLeft/Right at TOC moves selection without entering, Enter enters.
7. **Make DayColumn keyboard-reachable** (P1-4) — `role="button"`, `tabIndex={0}`, `onKeyDown` for Enter/Space.
8. **Decouple VU meter from React render cycle** (P1-9) — direct DOM update or a leaf component subscribing to a level event source.
9. Everything in P2 as cleanup.

---

## Postmortem Note

Tasks 8 → 19 were each correct in isolation. The failure mode here is: nobody ran the resulting UI end-to-end with **only** a keyboard, with an actual mic, on the actual deploy target, between Task 11 (the meter) and Task 18 (the typography pass). Either step alone would have caught both P0s in seconds.

For future multi-task feature trains: pin a "manual integration check" task at the end of the plan before merging. The cost is 10 minutes; the cost of skipping it is feature ships and saves audio while the user reports "the whole UX is D-".
