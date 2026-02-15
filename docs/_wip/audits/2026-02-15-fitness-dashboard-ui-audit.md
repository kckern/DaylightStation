# Fitness Dashboard UI Audit

**Date:** 2026-02-15
**Screen:** HomeApp dashboard (`/fitness/home`)
**Viewport:** ~1400x850 (kiosk/desktop)

---

## Overall Grade: C+

| Category | Grade | Notes |
|----------|-------|-------|
| Aesthetics | C | Weight widget breaks visual cohesion; 60% of screen is empty states |
| Usability | B- | Session card is strong; bottom row underwhelms |
| Consistency | D+ | Weight widget is a completely different design language |
| Information density | C+ | Good data in sessions card, rest is sparse |
| Responsiveness | B | Grid adapts, but empty states waste space |

---

## Section-by-Section

### 1. Recent Sessions Card (Top-Left) — Grade: B+

**Strengths:**
- Clear hierarchy: episode title (bold) > show name (dimmed) > metadata row
- Thumbnails and posters load correctly, give visual identity to each row
- Participant avatars provide at-a-glance "who was there" info
- Coin count and duration badges are compact and readable
- Good use of the available width

**Issues:**
- **Poster alignment:** Posters float right but aren't vertically centered with their row content. The gap between the text block and the poster varies per row, creating a ragged right edge.
- **Avatar row adds height inconsistently:** Row with 5 avatars (Mario Kart Wii) is notably taller than row with 1 avatar. This creates uneven row heights across the list.
- **Long titles:** "Upper Body Stretches: Upper Body Stretch with Elise Joan" wraps awkwardly. Should truncate with ellipsis.
- **Missing coins on 3 of 5 rows:** Only 2 sessions show coin counts. The inconsistency makes you wonder if it's a bug or if those sessions genuinely earned zero.
- **No date grouping:** "Fri, Feb 13" appears twice without a visual separator. A subtle date header between day groups would reduce scanning effort.

### 2. Up Next Card (Top-Right) — Grade: D

**Issues:**
- Empty state "No workout recommendations yet" floats in a vast empty area (~40% of above-fold space)
- No card wrapper or background — just orphaned dimmed text
- When this card has no data, the layout should either collapse or the sessions card should expand to fill

### 3. Weight Widget (Bottom-Left) — Grade: D

**Issues:**
- **Design language mismatch:** Uses white/light-gray tabular headers with a completely different typography and color scheme than every other card on the dashboard. Looks like an embedded iframe from a different app.
- **Not wrapped in a DashboardCard:** Every other section uses the semi-transparent dark card styling. This widget uses its own opaque styling.
- **Chart is cut off:** The weight trend chart at the bottom is clipped, showing only a sliver of data points. No vertical axis labels visible.
- **Information overload in header:** 5 metrics crammed into a single header row (Weight, Composition, 7 Day Trend, Daily Calories, Days to 18%). The "Daily Calories" metric (315) seems out of place in a weight widget — it belongs in the nutrition card.
- **"Days to 18%" label:** Domain-specific goal that needs context. What is 18%? Body fat target? Not self-explanatory to someone glancing at the dashboard.

### 4. Nutrition Card (Bottom-Center) — Grade: B

**Strengths:**
- Clean, scannable table layout
- Macro badges (P/C/F) are color-coded and compact
- Calorie values are right-aligned for easy comparison

**Issues:**
- Only 3 days visible despite fetching 10 days of data. The card height is constrained by the grid row, hiding most of the data.
- No visual indicator of calorie targets (e.g., a subtle progress bar or color-coding for over/under)
- The "cal" label is repeated on every row — could be in the header instead

### 5. Coach Card (Bottom-Right) — Grade: D

**Issues:**
- Empty state "Coach insights will appear here" with no visual interest
- Same problem as Up Next: vast empty area with orphaned text
- When both the Up Next and Coach cards are empty, 50%+ of the dashboard is placeholder text

---

## Cross-Cutting Issues

### Visual Consistency
- **Two design systems on one screen:** The Weight widget uses opaque light-themed headers and a tabular layout. Everything else uses semi-transparent dark cards with the DashboardCard wrapper. This is the single biggest aesthetic issue.
- **Badge styles vary:** Session card uses `variant="light"` badges for duration (blue) and coins (yellow). Nutrition card uses small colored badges for macros. Weight widget uses its own inline styling.
- **Empty state treatment:** Up Next and Coach show floating dimmed text. Other cards (if empty) show centered text inside a card wrapper. Should be uniform.

### Information Architecture
- **Above-fold waste:** When Up Next and Coach are empty (which appears to be the common state), the top row is 60% wasted. Sessions card carries all the value.
- **Bottom row parity:** Three 4-col cards, but Weight takes significantly more vertical space than Nutrition or Coach, causing the grid row to be sized to the tallest element.

### Spacing & Alignment
- **Session row right alignment:** The poster images aren't aligned to a consistent right edge. The flex gap between text content and poster varies by row.
- **Avatar vertical rhythm:** Avatars sit on their own line below the metadata, which is good, but adds variable height per row.

---

## Recommendations (Priority Order)

### P0 — Fix Now
1. **Wrap Weight widget in DashboardCard** or restyle it to match the dark semi-transparent theme. This is the most jarring inconsistency.
2. **Collapse empty cards:** When Up Next has no data, give sessions card full width (`span={12}`). Same for Coach — if empty, let Nutrition expand.

### P1 — Should Fix
3. **Truncate long session titles** to single line with ellipsis.
4. **Add date group headers** in session list (e.g., a subtle "Yesterday" or "Fri, Feb 13" separator between day groups, rather than repeating the date on each row).
5. **Fix Weight chart clipping** — either give it enough height or hide it when space is insufficient.
6. **Move "Daily Calories" out of Weight widget** — it's nutritional data, not weight data.

### P2 — Nice to Have
7. **Vertically center posters** with their row content.
8. **Show coin count as 0** explicitly (or hide the badge) — currently ambiguous when missing.
9. **Add a "no data" card design** for empty states instead of floating text — a card with a subtle icon and message.
10. **Limit nutrition to visible rows** or make the card scrollable.
