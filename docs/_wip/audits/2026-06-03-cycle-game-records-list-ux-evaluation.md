# Cycle Game — "Records" List UX Evaluation

**Date:** 2026-06-03
**Surface:** The lobby records rail (`cycle-game-home__records`) in
`frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`.
**Scope:** Evaluation only — no code changes. Companion redesign + plan to follow.
**Subject:** The **Cycle Game / Race** records rail. (Not the governance Cycle
Challenge.)

## What it is

A right-hand `<aside>` titled **RECORDS** listing recent saved races. Each row is a
`<button>` (`record-{raceId}`) that opens the **Recap** replay. Rows are built in
`CycleGameContainer.jsx` (`records` memo, ~`:472–481`) from `ghostCandidates`
(~`:419–470`) and carry:

```
{ raceId, avatars[≤4]{id,src,name}, goalKind, goalLabel, scoreKind, scoreLabel }
```

**The encoding (grounded in code):**
- Participants are sorted **winner-first** (`participants[0]` is the winner).
- The **pill** (`🏁 {goalLabel}`) is always the **goal / win condition**.
- The **cyan italic value** (`{scoreLabel}`) is always the **winner's result**.
- Which *metric* each holds **flips by race type** (`:464–467`):
  - Distance race → goal = distance (e.g. `1.00 km`), result = time (e.g. `5:13`).
  - Time race → goal = time (e.g. `1:00`), result = distance (e.g. `105 m`).
- Pill border hue encodes type (blue = distance, gold = time). The 🏁 glyph is
  identical on every row.

## Scorecard

| Dimension (rubric) | Grade |
|---|---|
| Consistency & standards (Nielsen #4) | **D** |
| Recognition over recall (Nielsen #6) | **D+** |
| Temporal context / visibility of status (Nielsen #1) | **F** |
| Comparability & scannability (Tufte / Gestalt) | **D+** |
| Accessibility (WCAG 1.4.1 / 1.4.3 / 2.5.5) | **C−** |
| Labeling & terminology | **C−** |
| Information hierarchy | **C** |
| Visual craft / aesthetic | **B+** |
| **Overall** | **C− / D+** |

## Findings (severity-ranked)

### Critical

**F1 — The two value slots swap meaning every row.** `goalKind`/`scoreKind` invert
by race type, so the same visual position means "minutes" on one row and "meters"
on the next. The reader re-derives "is this a distance or a clock?" on every row.
Textbook consistency violation; root cause of the felt "confusion."
*Evidence:* during review a viewer guessed a non-existent rule ("whichever value is
in a pill tells the type") — the encoding is opaque enough to invent wrong rules.

**F2 — No labels.** No column headers, units legend, or "goal/result" cues. The
encoding is pure recall — decodable only by someone who already knows the system.

**F3 — "RECORDS" is a misnomer.** The list is `pastRaces` mapped 1:1,
recency-ordered — a **history log**, not records / personal bests (nothing filters
for best performances). The title overpromises and seeds the wrong mental model.

**F4 — The date/time is computed, then discarded.** `day` and `timeOfDay` are
derived for the ghost picker (`:449–456`) but omitted from the records rows
(`:472–481`). A history list with **no "when"** fails temporal orientation — and is
internally inconsistent, since the ghost picker on the same screen *does* show
time-of-day. Free data, dropped.

**F5 — Race type rides on color alone (WCAG 1.4.1).** Distance vs time reads only
from pill hue + value format; the flag glyph is identical and carries no
information. Color-blind / low-vision / at-distance viewers can't reliably tell the
two race types apart.

### Medium

**F6 — Non-comparable stacked metrics.** One column interleaves `105 m`, `5:13`,
`1.18 km`, `3:47` with no grouping. A vertical numeric column invites comparison;
these aren't comparable. The list *looks* rankable and isn't.

**F7 — Result column doesn't align.** Cyan values float right of variable-width
pills (`1:00` vs `1.00 km`), so they begin at different x-positions per row — no
shared edge, broken scan line (Gestalt alignment).

**F8 — Identity without outcome.** Avatars show *who raced* but not *who won*, no
placement, no "you" marker. For a records/results list the winner is the headline;
it's absent (the result is silently the winner's, with no link to an avatar).

**F9 — Unit inconsistency.** Result distances switch between `m` and `km`
(`105 m` … `1.18 km`) with no visible threshold rationale, adding parse cost.

### Low / polish

- **F10 — Inverted hierarchy:** the least self-explanatory element (cyan result) is
  the most visually dominant (glow, italic, largest); identity is under-weighted.
- **F11 — Affordance/focus:** rows are buttons but show no "view recap" cue; on a
  10-foot TV UI the focus state must be unmistakable (unverified statically).
- **F12 — No count, sort indicator, or day-grouping.**
- **F13 — Faint dividers.**

## What's working (fair credit)

- Cohesive synthwave styling; consistent row rhythm and generous spacing read well
  at TV distance.
- Avatar-first rows aid fast recognition of frequent riders.
- The flag+value chip grouping is a tidy, modern pattern.
- The cyan emphasis gives each row a clear focal "payoff" number — good execution;
  the problem is *what* it emphasizes, not *how*.

## Convergence with stakeholder feedback

Independent stakeholder review raised the same core issues and sharpened two:

| Stakeholder observation | Finding | Note |
|---|---|---|
| "Should be **columns**, not free-flowing" | F6 + F7 | Sharper prescription: a true tabular grammar (a value's column tells you its kind) fixes F1 **structurally**, not via labels alone. |
| "Doesn't tell me the **date/time**" | F4 | Exact match; data already exists. |
| "Does order mean **who won**? Mark the winner; shrink runners-up to fit" | F8 + F10 | Merges winner-identity and hierarchy into one space-saving move. |
| "Doesn't say **distance vs time**; pills/color unclear" | F5 + F1 | The viewer's own misread is live evidence. |
| "A lot of **confusion**" | F1 + F2 | The cumulative symptom. |

## Recommended direction

1. **Fixed columns.** Give every row a stable grammar so a value's *column*
   declares its kind — this kills F1 structurally. Distances live in one column,
   times in another; mark which cell was the **goal**.
2. **Surface the date/time** (already computed).
3. **Mark the winner** (crown / prominence); de-emphasize runners-up (also buys
   horizontal space for the date column).
4. **Name the race type** with a clock/ruler icon — not color, not a repeated flag.
5. **Header row + units;** rename "Records" → "History" (or compute actual bests if
   "Records" is intended literally).

A redesign mock + implementation plan follows this audit.
