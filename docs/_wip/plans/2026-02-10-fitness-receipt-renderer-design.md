# Fitness Receipt Renderer Design

**Date:** 2026-02-10
**Status:** Draft

## Overview

A thermal receipt renderer for fitness sessions — a fun, full-featured post-workout summary the family can hold. Follows the same pattern as `GratitudeCardRenderer.mjs`: node-canvas rendering with a separated theme file, factory function with dependency injection, returns `{ canvas, width, height }`.

**Location:** `backend/src/1_adapters/fitness/rendering/FitnessReceiptRenderer.mjs` + `fitnessReceiptTheme.mjs`

## Receipt Layout (top to bottom)

### 1. Header

- Title: "FITNESS REPORT"
- Date + time: `Sun, 9 Feb 2026, 9:16 PM`
- Duration: `48 min 35 sec`
- Participant roster line: `Milo  Alan  Felix  KC  Soren`
- Bordered, centered, same style as gratitude card

### 2. Treasure Box

- Total coin count, large and centered
- Horizontal stacked bar showing bucket distribution proportionally (green/yellow/orange/red)
- Per-bucket coin counts below the bar
- Omitted if totalCoins is 0

### 3. Flame Chart (centerpiece)

Vertical timeline reading top-to-bottom (start to end of session). Each participant gets a column. Zone determines bar width, centered symmetrically within the column:

| Zone   | Bar Width |
|--------|-----------|
| cool   | 1px       |
| active | 3px       |
| warm   | 5px       |
| hot    | 7px       |
| fire   | 9px       |

(Actual pixel values tuned in theme to fit 580px width across all participants.)

**Rendering rules:**
- **Dotted line** for ticks where the session is running but the participant has not yet joined (null HR data)
- **Solid centered bar** once the participant has HR data, width based on zone
- **Participant names** as column headers above the chart
- **Time labels** on the left margin at regular intervals (every ~5 min)
- **Downsample** tick data to keep chart ~200-300 rows (e.g., every 15-20 seconds per row instead of every 5 seconds)

**Event markers** appear in the left margin at the correct vertical time position, with a horizontal line across the chart:

| Symbol | Event Type  |
|--------|-------------|
| ★      | Challenge   |
| ♫      | Media start |
| 🎤     | Voice memo  |

Each marker has a short label on the right margin (e.g., challenge name, media title, memo preview).

### 4. Leaderboard

Participants ranked by coins earned (highest first). Each entry:

- **Rank + name + coins** on the headline
- **Peak HR** in bpm
- **Mini intensity bar** — horizontal gauge showing proportion of active time in warm+ zones
- **Duration** they were actually active (not the full session, just their participation time)

### 5. Event Detail Sections

Expandable detail for each event type, using the same symbol as chart markers. Sections are **omitted entirely** if no events of that type exist.

#### Challenges
- Symbol: ★
- Time, challenge name
- Goal description (e.g., "1 participant in warm zone")
- Result: PASSED/FAILED + count (e.g., "3 of 3")
- Names of participants who met the challenge

#### Media
- Symbol: ♫
- Time, media title
- Collection context (e.g., "Fitness > Workout")
- Resume position if applicable

#### Voice Memos
- Symbol: 🎤
- Time, duration
- Full transcript, text-wrapped

## Data Contract

Input to the renderer factory:

```js
createFitnessReceiptRenderer({
  getSessionData,   // async () => parsed session YAML object
  fontDir,          // optional font directory path
})
```

The `getSessionData` function returns the v3 session YAML structure:

```yaml
session:
  id, date, start, end, duration_seconds
participants:
  {slug}: { display_name, hr_device, is_primary }
timeline:
  series:
    {slug}:hr, {slug}:zone, {slug}:coins, {slug}:beats
    device:{id}:heart-rate
    global:coins
  events: [{ timestamp, type, data }]
  interval_seconds, tick_count
treasureBox:
  totalCoins, buckets: { green, yellow, orange, red }
events: [{ at, type, data }]  # v2 flattened events
```

## Theme File

`fitnessReceiptTheme.mjs` — same pattern as `gratitudeCardTheme.mjs`:

- `canvas.width`: 580 (standard thermal receipt)
- `layout.*`: margins, spacing, section gaps
- `fonts.*`: header, subheader, label, value, memo text
- `colors.*`: black/white only (thermal printer)
- `chart.zoneWidths`: `{ cool: 1, active: 3, warm: 5, hot: 7, fire: 9 }`
- `chart.downsampleInterval`: target seconds per row (default 15)
- `chart.columnGap`: spacing between participant columns
- `chart.dotRadius`: size of dotted-line dots for pre-join
- `chart.eventSymbols`: `{ challenge: '★', media: '♫', voice_memo: '🎤' }`
- `leaderboard.barWidth`: width of the mini intensity gauge
- `treasureBox.barHeight`: height of the stacked bucket bar

## Architecture Notes

- **Adapter layer** (`1_adapters/fitness/rendering/`) — same level as gratitude rendering
- **No domain logic** — the renderer just reads a session data object and draws it
- **RLE decoding** — zone/HR series come RLE-encoded in the YAML; renderer must decode before drawing
- **Zone mapping** — zone symbols in data: `c`, `a`, `w`, `h`, `fire` → map to widths via theme
- **Upside-down support** — same `upsidedown` flag as gratitude renderer for mounted thermal printers

## Open Questions

- Should the chart use filled rectangles or line-drawing characters for the flame bars?
  - **Recommendation:** Filled black rectangles — cleaner on thermal print, no font dependency for the chart itself
- Should there be a max participant count before column width gets too narrow?
  - 580px / 6 participants ≈ 96px per column — still workable. 8+ might need smaller zone widths.
