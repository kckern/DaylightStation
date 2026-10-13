# Fitness Chart Participant Focus Filter

## Problem

When multiple participants have overlapping heart rate lines and avatars on the race chart, it's difficult to analyze individual performance. Lines cross over each other and avatar images stack/collide.

## Design

### Filter UI

- Render a vertical filter panel below the LIN/LOG toggle when `roster.length > 1`
- Each row: 20px avatar image (zone-colored border) + display name label
- Always uses display name, never userId
- Positioned absolute at `top: ~3.5rem`, `left: 2.5rem`, `z-index: 5`
- Clicking a user enters focus mode; clicking again exits
- Single selection only — one focused user at a time

### Focus Mode Behavior

When a user is focused:

1. **Paths**: Focused user `opacity: 1`, all others `opacity: 0.1`
2. **Endcaps**: Avatar images always shown (never replaced with letters). Focused user full opacity, others 10%
3. **Z-order**: Focused user's path and avatar SVG groups render last (on top)
4. **Connectors & badges**: Non-focused users dimmed to 10%
5. **Filter UI**: Selected row gets brighter text and thicker avatar border

When no user is focused (default): all participants render normally with avatar images as today.

### State

- `focusedUserId`: `null` (no focus) or user ID string
- Opacity and z-order derived per participant at render time
