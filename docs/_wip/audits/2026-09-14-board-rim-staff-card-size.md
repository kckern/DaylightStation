# Board rim staff cards are too small — options, measured

**Games:** Chess, Checkers, Connect Four (reading vocabulary — the staff cards on
the board rim, `StaffNoteLabel`).
**Harness:** `tests/_infrastructure/harnesses/piano-board-rim/run.mjs` — real
frame, stage, rails, boards and staff cards with their real SCSS, rendered
headlessly on the 1280×800 design canvas. Touches no kiosk, learner or API.

```bash
node tests/_infrastructure/harnesses/piano-board-rim/run.mjs [outDir]
```

## Outcome (2026-09-14)

Option 1 shipped as a first-class kiosk capability rather than a game mode: one
full-screen toggle (header, floating corner, or a board game's rail foot — never
two at once), remembered per device. Board games opt in to a 3rem keyboard;
Checkers raises its rim to 5rem and Connect Four lifts its ceiling while it is
on. Connect Four's column rail moved inside the board slot so it stays aligned
when the board goes height-bound (0px drift, measured). Chess's rim was also
inset by the board frame border, which had walked cards up to 4px off their
squares (now 1.4px, the card gap). Scenario `FS-kiosk` in the harness renders
the real provider:

| Game | Normal | Full screen |
|---|---|---|
| Chess | 8.3 / 7.4 px | 9.3 / 8.3 px |
| Checkers | 7.2 / 7.3 px | 9.8 / 8.8 px |
| Connect Four | 8.0 px | 10.8 px |

Option 2 (range-cropped cards) is not built; it stacks with this.

The metric is **line spacing**: rendered px between two staff lines. On the
tablet one CSS px is roughly 0.18 mm, so 8px ≈ 1.4 mm. Ordinary printed music is
about 1.75 mm (≈10px); beginner editions are larger.

## Today

| Game | File card | Rank card | Spacing file / rank |
|---|---|---|---|
| Chess | 60×67 | 74×60 | 8.4 / 7.5 px |
| Checkers | 58×58 | 58×58 | 7.2 / 7.3 px |
| Connect Four | 58×65 | — | 8.1 px |

Every rim is smaller than the printed music on the same music desk.

## Where each game's limit actually is

- **Chess — height.** The board is height-bound; rails do not matter (fixed
  11rem rails and no rails at all both measured identical to 0.28fr rails).
- **Checkers — its own rim token.** `--ck-rank-rail: 3.6rem` fixes one card
  dimension. Freeing the whole screen grew the board 540→700px and the cards not
  at all. Raising the token alone (5rem) buys nothing either: the square pitch
  then binds. It needs both.
- **Connect Four — `--pg-board-max: 34rem`.** Header, keyboard and rails change
  nothing until the ceiling is lifted. Lifting it (today's chrome) gives
  10.8 px, but the board goes height-bound while the column rail stays
  width-bound, so the cards stop sitting over their columns — the rail has to
  move inside the size container first (already predicted in
  `PianoConnectFour.scss`).
- **All three — the card itself.** The engraver draws a 100×112 viewBox: the
  clef takes about half the width and two spaces of padding above and below take
  half the height. The notehead gets a small fraction of the card.

## Option 1 — focus mode while playing (chrome)

| Scenario | Chess | Checkers | Connect Four |
|---|---|---|---|
| Header hidden | 9.3 / 8.3 | 7.2 / 8.1 | 8.1 |
| + keyboard 3rem | 9.4 / 8.4 | 7.2 / 8.1 | 8.1 |
| + keyboard hidden | 10.4 / 9.3 | 7.2 / 8.1 | 8.1 |
| + checkers rim 5rem | — | 9.8 / 8.8 | — |
| + C4 ceiling lifted | — | — | 11.7 |
| Rails narrowed | no change | no change | alignment breaks |

Feasible, with three costs:

1. **The header is the way out.** Games exit by tapping the "Games" crumb.
   `PianoChrome` renders unconditionally in `PianoApp`; there is no hide
   mechanism. Hiding it needs a shell-level flag the game host sets while
   `phase === 'playing'`, and an exit elsewhere — `useVanishingControls` (the
   Music player's auto-hide) is the house pattern for revealing it on touch.
2. **The connection chip lives there.** A disconnected piano must still say so
   when the header is hidden.
3. **Keyboard.** Chess's dock is display-only. Checkers and Connect Four pass
   `onNoteOn`, so theirs is touch input; 3rem (48px) stays above the 2.75rem tap
   floor, hiding it removes an input.

Narrowing rails is not worth it: it moves no card in Chess or Checkers, and the
chess rail is already the densest in the kiosk.

## Option 2 — spend the card's pixels on the note (notation)

Same card boxes as today (Chess shown), drawn over only the range the axis
names — all five lines, every note on the axis, half a space of air — with one
scale per axis so every card on a strip matches.

| Variant | Chess file | Chess rank |
|---|---|---|
| Today | 8.4 | 7.5 |
| Range-cropped, clef on every card | 13.0 | 10.9 |
| Range-cropped, one clef per strip | 15.1 | 10.9 |

Ranks are height-bound (square pitch), so only cropping helps them; files are
width-bound, so dropping the repeated clef helps them most. One clef at the head
of a line is also how a score is written. File cards may use the strip height the
board already reserves (`--pc-axis`), which today's aspect lock leaves empty.

Applies to all three games at once through `StaffNoteLabel`. It needs a rim
drawing mode in which lines and notation scale together (no `STAFF_ASPECT` lock),
kept beside rather than inside the shared `SvgStaffRenderer` used by the other
games. Preserve ghost notes, the locked highlight and the deal animation.

## Recommendation

Option 2 first: the largest gain (+45–80%), no lost chrome, all three games.
Then Option 1 as a playing-only focus mode (header hidden with a touch reveal,
keyboard 3rem), paired with the two per-game tokens — Checkers' rim and Connect
Four's ceiling with its rail moved into the size container. Together Chess files
reach roughly 2× today.
