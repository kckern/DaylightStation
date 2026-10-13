# Readalong Sticky Header Design

## Problem

The ContentScroller has separate `<h2>` (title) and `<h3>` (subtitle) elements stacked vertically, consuming ~112px of screen height. On the Shield TV's limited viewport, this wastes space that should be used for content. Additionally, as the user reads through content with multiple sections (chapters, headings), there's no persistent indicator of which section they're currently in.

## Design

### Single Dynamic Header Bar

Replace the separate `<h2>` and `<h3>` with a single header element that combines both roles.

**States:**

1. **Title-only (on load):** Title is centered in the header bar. No subtitle content visible. This is the initial state before any in-body headings have scrolled past.

2. **Title + section (during scroll):** When an in-body heading (`<h4>` in the rendered content, from `##`-prefixed lines) scrolls above the visible area, the header transitions:
   - Title slides from center to left
   - The heading text fades/slides in on the right side
   - This gives persistent section context while preserving the title

3. **Section updates:** As subsequent headings scroll past, the right-side text cross-fades to the new section heading.

4. **Return to title-only:** If the user seeks back above all headings, the section text fades out and the title returns to center.

### How It Works

**Heading position tracking:**
- After the content renders, measure the `offsetTop` of each `<h4>` element within the `scrolled-content` div
- Store these positions in a ref (same pattern as the menu's `buildLayoutCache`)
- Positions are relative to the content container, so they can be compared directly against `yOffset`

**Current section detection:**
- On each render (driven by the 100ms `syncInterval` that updates `currentTime` → `yOffset`), determine which `<h4>` is "current"
- The current heading is the last `<h4>` whose `offsetTop` is less than or equal to `yOffset` (it has scrolled past the top)
- Store the current heading text in state; only update when it changes to avoid unnecessary re-renders

**CSS transitions:**
- Title position: `transition: all 0.4s ease` — moves between `text-align: center` (no section) and `text-align: left` (section active) via a wrapper class
- Section text: `opacity` + `translateX` transition for fade+slide effect
- Use a `has-section` class on the header to toggle between centered and split layout

### Layout

```
[  Title (centered)                    ]   ← no section heading scrolled past

[  Title          |   Section Heading  ]   ← heading has scrolled off-screen
```

Height: same as current h2 (~4rem / 64px). Saves ~48px by eliminating h3.

### Affected Files

| File | Change |
|------|--------|
| `frontend/src/modules/Player/renderers/ContentScroller.jsx` | Replace h2+h3 with single dynamic header; add heading position tracking; add current-section detection based on `yOffset` |
| `frontend/src/modules/Player/styles/ContentScroller.scss` | Remove h3 styles; restyle h2 as dynamic header with transition states; add section text styles with fade/slide animation |

### Edge Cases

- **No headings in content:** Header stays in title-only centered state permanently. Equivalent to current h2-only display.
- **Subtitle prop still passed:** Shown as initial section text (before any in-body heading scrolls past), or ignored if the content has headings. Decision: ignore subtitle when content has h4 headings; use subtitle as fallback section text only when there are no h4s.
- **Seek backward past all headings:** Section text fades out, title re-centers.
- **Very long section heading text:** Truncate with `text-overflow: ellipsis` — same pattern as current h2.
- **Shader modes (night, minimal, video, etc.):** All existing `h2, h3` rules in SCSS change to target the single header element. Minimal/video/text modes hide the header entirely (existing behavior preserved).
