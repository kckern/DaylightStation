# Mega Man Life Meter — Governance Warning Countdown

**Date:** 2026-02-14
**Status:** Design
**Files:**
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.jsx`
- `frontend/src/modules/Fitness/FitnessPlayerOverlay/GovernanceStateOverlay.scss`

## Summary

Replace the horizontal countdown progress bar in `GovernanceWarningOverlay` with a vertical segmented "Mega Man life meter" on the left edge of the video area.

## What Changes

### JSX (GovernanceWarningOverlay, lines 77-82)

Replace the `__track` / `__fill` div pair with:

```jsx
<div className="governance-life-meter" aria-hidden="true">
  <div className="governance-life-meter__frame">
    {Array.from({ length: TOTAL_NOTCHES }, (_, i) => (
      <div
        key={i}
        className={`governance-life-meter__notch${i < visibleNotches ? ' governance-life-meter__notch--active' : ''}`}
      />
    ))}
  </div>
</div>
```

- `TOTAL_NOTCHES` = 28 (const)
- `visibleNotches = Math.round(progress * TOTAL_NOTCHES)` where progress = remaining / total
- Notches render bottom-to-top (CSS `flex-direction: column-reverse`)
- As countdown drains, notches disappear from the top down one at a time

### SCSS

**Meter container** (`.governance-life-meter`):
- `position: absolute`
- `left: clamp(12px, 2vw, 32px)`
- `top: 50%; transform: translateY(-50%)` (vertically centered)
- `height: 80%` of the overlay/video area
- `width: clamp(32px, 3.5vw, 56px)`
- `z-index` matches existing overlay z-index
- `pointer-events: none`

**Frame** (`.governance-life-meter__frame`):
- `height: 100%; width: 100%`
- `display: flex; flex-direction: column-reverse` (fill from bottom)
- `gap: clamp(1px, 0.15vh, 3px)` between notches
- `padding: clamp(4px, 0.5vw, 8px)`
- `background: #0a0a12` (deep dark interior)
- `border: clamp(2px, 0.3vw, 5px) solid #1a1a2e` (dark charcoal frame)
- `border-radius: clamp(6px, 0.8vw, 14px)` (rounded capsule ends)
- `box-shadow: inset 0 0 0 clamp(1px, 0.1vw, 2px) rgba(255,255,255,0.08)` (inner bevel highlight)

**Notch segments** (`.governance-life-meter__notch`):
- `flex: 1` (each notch shares height equally)
- `width: 100%`
- `border-radius: clamp(1px, 0.1vw, 2px)`
- `background: transparent` (default hidden)
- `transition: none` (discrete, no smooth animation)

**Active notch** (`.governance-life-meter__notch--active`):
- `background: #e8b830` (gold/yellow)
- `box-shadow: inset 0 clamp(-1px, -0.1vh, -2px) 0 rgba(0,0,0,0.35)` (bottom inset shadow for pixel-art depth)
- `border-top: clamp(1px, 0.08vh, 2px) solid rgba(255,235,150,0.6)` (top highlight for 3D notch look)

### What Does NOT Change

- Offender chips (`__offenders`, `__chip`, etc.) — remain at bottom center, untouched
- `GovernancePanelOverlay` (locked/pending states) — no changes
- `GovernanceAudioPlayer` — no changes
- The `progress` calculation logic stays the same

## Layout

```
┌─────────────────────────────────┐
│ ┌──┐                            │
│ │██│                            │
│ │██│                            │
│ │██│        VIDEO AREA          │
│ │██│                            │
│ │  │                            │
│ │  │                            │
│ │  │    [offender chips]        │
│ └──┘                            │
└─────────────────────────────────┘
  ^-- life meter (left, centered vertically)
```

## Implementation Steps

1. Add `TOTAL_NOTCHES` const and `visibleNotches` calculation to `GovernanceWarningOverlay`
2. Replace the `__track`/`__fill` markup with the life meter markup
3. Update container positioning — meter is `position: absolute` inside the existing `governance-progress-overlay` (which is already `position: absolute`)
4. Add all `.governance-life-meter*` SCSS rules
5. Verify the offender chips are unaffected (no layout changes to `__offenders`)
6. Test at multiple viewport sizes to confirm responsive scaling
