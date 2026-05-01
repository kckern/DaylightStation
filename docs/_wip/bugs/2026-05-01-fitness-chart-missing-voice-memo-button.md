# 2026-05-01 — No voice-memo button on the post-episode FitnessChart screen

## Symptom

When an episode ends, the player redirects to the FitnessChart overlay. If the user already recorded a voice memo for this episode (so the auto-prompt overlay does *not* re-open), they have no way to add a follow-up memo from the chart screen — there is no record button visible, even though a session is still active.

## Evidence (code paths)

The voice-memo floating action button (FAB) exists in `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1575-1588`:

```jsx
{playerMode === 'fullscreen' && fitnessSessionInstance?.isActive && (
  <button
    type="button"
    className="fitness-player__voice-memo-fab"
    onClick={() => openVoiceMemoCapture?.(null)}
    …
  >
```

It is gated on `playerMode === 'fullscreen'`. The chart overlay renders just above this block:

```jsx
{showChart && govStatus !== 'locked' && govStatus !== 'pending' && (
  <div className="fitness-chart-overlay">
    <FitnessChartBackButton onReturn={() => setShowChart(false)} />
    <FitnessChart mode="sidebar" onClose={() => {}} />
  </div>
)}
```

When `showChart` is true and `playerMode` is not `'fullscreen'`, the FAB is not rendered. The FitnessChart itself has no voice-memo entry point either (`frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx`).

The voice-memo system is fully wired through `FitnessContext` (`openVoiceMemoCapture`, `voiceMemoOverlayState`, `voiceMemos`) and `VoiceMemoOverlay` is mounted globally in `FitnessApp.jsx`, so the recording flow works from anywhere — the only thing missing is a UI affordance on the chart screen.

## Fix direction

Add a voice-memo record button on the chart overlay. Two reasonable placements:

1. **Inside `fitness-chart-overlay`** (simplest): render a FAB sibling to `FitnessChartBackButton`. Reuses the same SVG icon and `openVoiceMemoCapture(null)` call. Gate on `fitnessSessionInstance?.isActive` only — `playerMode` is irrelevant when the chart is up.

2. **Inside FitnessChart** as a chart-affordance: only do this if there's a design reason the chart needs to own it. Probably overkill for now.

Recommend option 1. The button should:

- Use the same look as the existing player FAB so the user recognizes it.
- Open `VoiceMemoOverlay` in capture mode via `fitnessCtx.openVoiceMemoCapture(null)`.
- Stay visible *regardless* of whether voice memos already exist for the active episode (this is the whole point of the bug — re-recording when no auto-prompt is coming).
- If you want to be fancy, show the existing memo count next to the record button (mirror the `FitnessVoiceMemo` panel's counter behavior at `frontend/src/modules/Fitness/player/panels/FitnessVoiceMemo.jsx:72-80`) — but that is a stretch; primary fix is just "let me record one more memo".

## Files involved

- `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` — add the FAB inside the `fitness-chart-overlay` block
- `frontend/src/modules/Fitness/player/FitnessPlayer.scss` (or whichever style file owns `.fitness-player__voice-memo-fab`) — verify the existing class works inside `.fitness-chart-overlay`, or add a chart-scoped selector
- `frontend/src/modules/Fitness/player/panels/FitnessVoiceMemo.jsx` — only consult, don't modify; same icon/handler patterns

## Manual verification (after fix)

1. Start a session, play an episode.
2. During playback, record a voice memo.
3. Let the episode end naturally so the FitnessChart appears.
4. Confirm the new record button is visible on the chart.
5. Tap it → `VoiceMemoOverlay` should open in capture mode.
6. Record + save a second memo → confirm both memos are present in the session.
