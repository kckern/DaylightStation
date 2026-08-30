# Party Games UX Audit — 2026-08-30

## Scope and method

This audit covers the TV shell rooted at `PartyGamesApp.jsx`, every mounted Party Games presenter, shared Gaming UI used by those presenters, the phone host, and the verifier surface. It evaluates layout, use of space, balance, overflow/wrapping, color, design-system adherence, interaction flow, transitions, animation, accessibility, and visible “AI slop” signals.

The live pass used the local app at a 960×540 TV viewport and 390×844 phone viewport. Ordinary persisted sessions were not used for the late-state pass: the Party Games diagnostic CLI created process-memory sessions, applied legal commands or explicit state overrides, attached the normal UI, and deleted the sessions afterward. Measurements below are from Chromium screenshots and computed layout, not source inspection alone.

## Verdict

The feature is not presentation-ready. Its best view is focused Charades, which has a coherent hierarchy and legible game-show type. Party Games should own a stylized entertainment-TV design system: a small shared broadcast/stage grammar with distinct show-specific art direction, not a generic Daylight skin or a large character/theme platform. The current shell and experiences do not yet implement that relationship. There are two release blockers—broken Jeopardy values/board and clipped primary controls—and a broad second tier of viewport, flow, design-system, and accessibility failures.

| Severity | Count | Summary |
|---|---:|---|
| P0 | 4 | Jeopardy renders `NaN`; Jeopardy board collapses; Activity drawing controls leave the frame; setup can hide the start action |
| P1 | 8 | Dice/Selector result overflow, no shell exit for utility games, shared-screen secret leakage, QR overlap, weak error/offline recovery, verifier dead end, host control ambiguity, broken results styling |
| P2 | 10+ | Token violations, sparse composition, copy inconsistency, missing focus/status semantics, weak transition language, generic/AI-like visual treatment |

## Release blockers

### PG-01 — Jeopardy’s mounted content contract renders `NaN`

**Severity:** P0

The mounted `Sample Family Night` round contains `{ name, mode, categories }` but no `multiplier`; the first clue has a valid numeric `value: 100`. Both TV and phone presenters multiply clue values by `round.multiplier`, producing `$NaN` on the clue, host tile, Daily Double wager, and Final wager. The board consequently communicates no usable values.

- Live TV clue: `$NaN`
- Live phone board tile: `$NaN`
- Live wager: `NaN`; pressing `+100` leaves it `NaN`
- Source: `Board.jsx:20`, `Jeopardy.jsx:128`, `PartyGamesHost.jsx:100,199-205`

The rules layer treats multiplier as optional in practice, while the presenters treat it as required. Normalize it to `1` at the content boundary and defensively use `round.multiplier ?? 1` in all presentation calculations.

### PG-02 — Jeopardy board collapses instead of filling the stage

**Severity:** P0

At 960×540, `.jp-board` measured only 32px high and each `.jp-board__tile` measured 0px high. Only the category label and score cards were visible. The direct Party Games route’s root resolves to content height rather than viewport height; `.jeopardy { height: 100% }` therefore has no stable containing block for its `flex: 1` board. The observed root was 172px high, leaving 368px of black frame.

Give the direct app surface a definite frame (`min-height: 100dvh` or an explicit host-container contract), retain `min-height: 0` at flex boundaries, and add a 960×540 visual regression assertion that every board tile has positive height.

### PG-03 — Activity Party drawing pushes controls and score out of frame

**Severity:** P0

The performing view reserves a 16:9 canvas at up to the full stage width after already laying out the header, decoder aid, timer, gaps, navigation, and scoreboard. At 960×540 the visible canvas starts at y=218 and continues to the bottom; Finish/clear controls and the scoreboard are absent. The canvas sizing in `ActivityParty.scss:9` has no available-height constraint.

Fit the canvas to both axes, not width alone—for example, dedicate a bounded flex/grid slot and use `aspect-ratio` with `max-height: 100%`. Keep the finish action and timer in persistent chrome. A game state is not operable if its only completion control is below a kiosk viewport.

### PG-04 — Team setup clips the action needed to continue

**Severity:** P0

In Teams mode at 960×540, both team cards are cut at the viewport bottom and the confirm action is not visible. `.gp-teamsetup__teams` uses `overflow: hidden` while each column scrolls independently (`TeamSetup.scss:17-45`), so the overall surface gives no visible overflow cue. The host-mode fieldset also takes a disproportionate 89px before the actual team task.

Pin the confirm action to a footer, make the team region the single explicit scroll container, and collapse host mode into a compact segmented control with user-facing labels. Do not require page/body scrolling on the TV surface.

## Screen-by-screen findings

| View/component | What works | Issues to address |
|---|---|---|
| Loading / creating session | Clear single task | No progress semantics, timeout, cancel, or recovery action; visual jump is instantaneous |
| Set picker | Large targets and readable title | Root is 486px in a 540px viewport, leaving a 54px black strip; five generic pills lack description, duration, player requirement, selected/focus hierarchy, Back/Exit; copy says “1 rounds” |
| Host-mode setup | Modes are mutually exposed with `aria-pressed` | Raw labels “human / computer / ai assisted” are implementation language; fieldset dominates the screen; no explanation of verifier consequences |
| Team setup — teams | Avatars and team-color grouping scan well | Confirm is clipped; independently scrolling cards; `+ Team` consumes a full column; overflow is hidden; no capacity or empty-team feedback |
| Team setup — individuals | Household members fit in one row at current data size | “Start with 0 players” has disabled-looking brown treatment but selection intent is unclear; no Select all/Clear; future names/counts will wrap unpredictably |
| Buzzer check | Simple ordered task | “or skip” is encoded as the same Start button, not a choice; no test feedback beyond text mutation; no Back; huge dead lower half |
| Error banner | Error text is visible | Error is rendered above whatever stale phase remains; no retry, exit, diagnostic ID, or focus movement; duplicate `.party-games__error` ownership |
| WebSocket warning | Non-blocking | A 60%-opacity lightning glyph with tooltip-only explanation is not understandable on TV, keyboard, or screen reader (`PartyGamesApp.jsx:97`) |
| Host QR | Consistent route to companion | Absolute bottom-right overlay reserves no space, obscures scores/controls in several views, uses 85% opacity that can reduce scan reliability, and remains present where it is not needed |
| Results | Ranking and actions are present | Undefined `--gp-navy`/`--gp-gold`; default browser buttons; ordered-list numbers disappear because `li` becomes flex; “Kids complete” is flat and mishandles ties; no celebration or transition; root is only 394px high |
| Activity — performer ready | Strong performer cue and clear primary action | Very large empty field; QR competes with score cards; action and title use a different visual language from Charades |
| Activity — challenge ready | Prompt and next action are obvious to the performer | Plain prompt is shown on the shared TV, revealing the answer to guessers; red/green striped decoder is visibly harsh and color-dependent |
| Activity — performing (draw) | Timer is prominent | PG-03; white canvas overwhelms visual balance; decoder aid sits over the content hierarchy; touch/canvas status is not announced |
| Activity — adjudication | Three outcomes are explicit | Four equal outlined controls form a long vertical stack; score adjustment competes with the primary judgment; Correct/Incorrect lack positive/danger distinction |
| Activity — verification | QR and “waiting” state are visible | Main QR plus persistent host QR is redundant; copy says authenticated controller without naming the person; no resend/change-host/cancel; no progress indication |
| Activity — challenge complete | Clear continuation | Generic success copy, no score-change animation or performer handoff transition |
| Focused Charades — ready | Best-composed screen; hierarchy, type, score, and action are coherent | QR still overlaps the right edge; oversized all-caps can break with long team names/translations |
| Focused Charades — secret | Physical-filter decoder makes the word less directly readable | Secret remains on the shared display and assumes the physical filter workflow without on-screen instruction; score cards are clipped at the viewport bottom |
| Focused Charades — performing | Timer, rule, and stop action are clear | Secret remains in the center throughout play; score cards and QR clip at the bottom; TimerRing has no accessible value/name |
| Focused Charades — adjudication | Outcomes fit in one row | All actions have identical treatment despite different consequence; no reveal of the actual answer in plain text for adjudication |
| Focused Charades — verification | State exists | Only “Waiting…” is rendered; no actor identity, QR, fallback, or cancellation in this focused presenter |
| Dice — ready | Presets are straightforward | Uses default white form controls, unrelated blue gradient, weak selected state, and no game-system button/input styling; no exit |
| Dice — result | Polyhedra give tangible feedback | Body/root grows to 638px in 540px viewport; custom input, Roll button, and much of QR are clipped; faces appear as flat gold polygons without roll motion in the captured committed state |
| Dice phone host | Large reachable Roll action | Vast empty middle, no notation picker, no connection state, no haptic/loading feedback; state label and total are disconnected visually |
| Selector — ready | Avatars make candidates recognizable; `aria-pressed` is used | Purple product island violates shared palette; selected state depends heavily on opacity/gold border; default Pick button; no explanation of multi-select toggles |
| Selector — winner | Winner has clear scale hierarchy | Root grows to 639px; candidate strip and QR clip; winner appears with a single generic pop but no selection/spin suspense; no Done/Exit |
| Jeopardy — round intro | Strong title card and primary button | “Sample Family Night — round 1” repeats the giant “ROUND 1”; root only 338px; QR crowds score cards |
| Jeopardy — board | Category and team state are intended to share stage | PG-01/02; tiles are non-semantic `div`s, cursor is color/outline only, and there is no accessible selected-tile announcement |
| Jeopardy phone board | Direct tile selection is better than a phone d-pad | `$NaN`; Print host packet appears before the game task; raw “BOARD” phase; category clipping; no sticky primary state/action at this phase |
| Jeopardy — clue/judging | Clue type is legible and keyboard legend is concise | `$NaN`; no visible category; timer lacks accessible state; QR crowds clue content; keyboard-only legend does not mention phone/buzzer paths |
| Jeopardy — Daily Double wager | Team and lock action are clear | `NaN`; TV `+100/−100` are wired to a no-op (`Jeopardy.jsx:129-130`), so even valid content would never change the 100 draft |
| Final — category | Familiar hierarchy | Root only 338px; no transition or music-aware reveal timing; QR remains visually dominant |
| Final — wager | One-team-at-a-time flow is understandable | `NaN`; other team cannot privately enter a wager on a shared TV; no privacy instruction or completed-team progress beyond text |
| Final — clue | Large readable clue | No timer or explicit phase progression on screen; keyboard legend is the only guidance; large unused lower field |
| Final — judging | Answer and per-team actions are visible | Four equal buttons make error-prone judging easy; no confirmation/undo; at 505px it barely fits before longer content or localization |
| Phone host — loading/error | Full-height surface | Error is plain text with no retry/back/session check; loading has no progress status |
| Phone host — general | Large touch controls and sticky action area | Raw machine phases, no command-pending disable, no optimistic/committed feedback, print action on every relevant screen, content can scroll behind sticky actions |
| Verifier — identity required | Error is unmistakable | Dead-end page with no sign-in/switch-account/retry path; excessive empty space; red-only status; QR destination does not explain required identity before scan |
| Verifier — confirmation | Explicit Confirm/Reject | Copy “This confirmation—not AI commentary—…” exposes architecture instead of user intent; no challenge/prompt/team context, making a safe judgment impossible |
| Effect overlay | Uses `aria-live="polite"` | “AI suggestion”/“Host commentary” labels expose implementation, fixed bottom overlay can cover controls, and content has no dismiss/history or motion discipline |

## Cross-cutting design-system findings

The token file explicitly states that no other Party Games stylesheet may declare a hex literal (`_tokens.scss:1-4`). That contract is broadly violated:

- `ActivityParty.scss`, `Charades.scss`, `DiceExperience.scss`, and `SelectorExperience.scss` each define independent palettes and controls.
- `DecoderPresenter.jsx` hard-codes red/green inline styles.
- `ImageDecoderDisplay.scss`, `SegmentedSecretText.scss`, and `SegmentedSecretText.jsx` contain additional palette literals.
- `Scoreboard.jsx` and `PartyGamesHost.jsx` use `#888` fallbacks rather than a semantic team-neutral token.
- Results references nonexistent `--gp-navy` and `--gp-gold` tokens (`PartyGamesResults.scss:8,12`).

This is not an argument for one global skin. Navy/brass Jeopardy, cyan/black Charades, blue Dice, and purple Selector can be legitimate show identities. The problem is that they are hard-coded as independent feature CSS rather than declared theme packs over a shared game-show contract. They fork ordinary controls and materials along with the scenic identity, so the system cannot preserve consistent stage geometry, interaction states, accessibility, or recurring chrome.

The button mixins also cover only a subset of controls. Dice, Selector, results, Activity, and parts of Charades use local or browser-default styles. Shared controls provide `:focus` rather than `:focus-visible`, no hover/pressed language for TV/desktop, and minimal disabled/busy feedback.

## Space, wrapping, and overflow

The root problem is an undefined frame contract. `PartyGamesApp.scss:3-6` uses `height: 100%`, but the direct route does not provide a definite 540px ancestor. Content-driven experiences therefore shrink (Jeopardy board/results) or grow beyond the viewport (Dice/Selector results). Local `min-height: 100%` plus padding further amplifies overflow.

Measured examples at 960×540:

| State | Root/body height | Consequence |
|---|---:|---|
| Set picker | 486px | 54px black strip |
| Jeopardy board | 172px; board 32px; tiles 0px | Game board unusable |
| Dice ready | 482px | Black strip |
| Dice result | 638px | 98px clipped below viewport |
| Selector ready | 388px | 152px black strip |
| Selector winner | 639px | 99px clipped below viewport |
| Final judging | 505px | Fits narrowly, no localization margin |
| Results | 394px | 146px black strip |

There are no Party Games responsive breakpoints for TV dimensions, long names, increased text size, or phone landscape. Flex wrapping exists in isolated rows, but truncation/overflow policy is otherwise accidental.

## Color and accessibility

- The red-stripe/green-text decoder is a hostile color pairing for common red/green deficiencies and produces shimmer at TV distance.
- Candidate selection uses opacity as a primary state cue; inactive people are visually treated as disabled.
- TimerRing is purely visual: no role, accessible label, remaining value, or live expiry status.
- Jeopardy tiles are `div`s rather than buttons/gridcells, so the keyboard cursor has no semantic focus equivalent.
- Media clue images use empty alternative text; audio/video presentation has no exposed playback or failure status for users.
- The WS glyph and several status treatments depend on tooltip, color, or animation.
- Infinite pulse animations call attention continuously. Reduced-motion CSS truncates them, but provides no static alternate state marker.

## Flow, transitions, and animation

Outer phases swap synchronously with no transition continuity. There is no shared visual language for entering a round, revealing a clue, committing a score, handing off to another performer, or completing a game. Most motion is either an infinite glow pulse or Selector’s one-off `scale(.4) rotate(-8deg)` pop. Dice outcomes are committed correctly, but the captured experience does not communicate the roll as a staged event.

The missing motion is not a request for decorative animation. The system needs short, functional transitions that answer: What changed? Who acts next? Was the command accepted? Did the score change? Reduced-motion users should receive the same answers through static emphasis and status text.

## “AI slop” tells

These details make the feature look generated or stitched together rather than intentionally art-directed:

- Giant centered headings above sparse, vertically stacked generic buttons.
- One-line “CSS dump” files for Activity, Dice, and Selector with hard-coded palettes and default controls.
- Unmodeled theme changes with no shared network/stage layer or declared show-pack contract.
- Architecture-facing copy: “AI suggestion,” “not AI commentary,” raw host modes, and raw machine phase names.
- Generic success language (“Clue complete,” “How did they do?”, “Game over 🎉”) without game-specific ceremony.
- Emoji status symbols (`⚡`, `🎉`) substituting for designed icon/status components.
- Redundant headings and template copy (“ROUND 1” plus “— round 1”; “1 rounds”).
- Heavy center alignment and unused space instead of a clear stage/chrome composition.

## Recommended remediation order

1. Establish a definite, box-sized Party Games viewport contract for direct and embedded surfaces; add 960×540 and 1280×720 screenshot/layout tests.
2. Normalize Jeopardy multiplier to `1`, fix all value calculations, give the board a real height, and make tiles semantic.
3. Rebuild Team Setup and Activity drawing around one bounded content region plus persistent footer actions.
4. Make Host QR an allocated/collapsible chrome region and remove it from states where the companion is already connected or unnecessary.
5. Define the minimal app-owned game-show grammar and show-scoped token contract. Reuse only the stage, scoreboard, timer, instructions, outcome, results, and control behavior that genuinely recur while preserving deliberate Jeopardy, Charades, Dice, and Selector art direction; remove undefined tokens and accidental browser defaults.
6. Repair terminal flows: add Done/Exit for Dice/Selector, verifier recovery/identity context, retryable shell errors, and tie-aware styled results.
7. Add functional transition states for command pending, score change, performer handoff, reveal, and game completion with reduced-motion equivalents.
8. Rewrite user-facing copy to describe roles and actions, not AI/system architecture.
9. Add accessibility coverage for focus order, semantic board navigation, timer status, media alternatives, color-independent selection, and 200% text.

## Validation record

- TV viewport: 960×540 Chromium
- Phone viewport: 390×844 Chromium
- Views captured: shell/setup/buzzer, Activity phases, focused Charades phases, Dice ready/result/host, Selector ready/winner, Jeopardy intro/board/clue/wager/final phases/results, verifier identity failure
- Diagnostic path: in-memory `diagnostic:*` sessions; legal advance and explicit override both verified; diagnostic sessions deleted after capture
- Source pass: shell, setup, all mounted presenters, shared UI, host/verifier, effects, styles, rules projections

## Implementation follow-up — 2026-08-30

The original findings above remain the point-in-time audit record. The remediation pass now has implementation coverage for every listed P0 and P1 class:

| Area | Implemented remediation |
|---|---|
| Jeopardy values and board | Optional round multipliers normalize to `1` across TV, wager, Final, and host presentation; tiles are semantic buttons/grid cells; the shell owns a definite frame. |
| Bounded TV composition | The app is a `100dvh` border-box stage; Activity drawing is height-and-width bounded with persistent tools; setup uses one scroll region and a fixed action; Dice and Selector use contained stage grids. |
| Shared design system | Network palette, show accents, control states, stage/header/instruction/action/outcome/companion primitives, timer semantics, score treatment, focus behavior, and reduced-motion timing now have shared sources of truth. |
| Secret and companion surfaces | Performing views conceal shared-screen secrets; adjudication reveals answers intentionally; companion QR content has an allocated rail or explicit verifier panel rather than overlapping play content. |
| Recovery and terminal flow | Shell errors provide Retry/Exit, controller disconnection has readable status copy, Dice/Selector provide Done, results are normalized and tie/scoreless aware, and ordinary completed sessions resume into results. |
| Host/verifier/effects | Host behavior is selected by experience ID with human phase copy and pending locks; verifier identity and challenge context are explicit; advisory effects use user-facing labels and can be dismissed. |
| Capability flow | Catalog metadata carries theme/input/lifecycle declarations; only `host-and-buzzer` experiences enter buzzer binding; non-buzzer games go directly to play. |
| Observability | The CLI creates, advances, overrides, inspects, and deletes process-memory diagnostic sessions without snapshot, journal, effect, print, or drawing persistence. |

Post-change automated evidence: 32 focused test files / 124 tests pass, the scoped Gaming ESLint pass has zero warnings, the repository parse gate passes, the frontend production build succeeds, and `git diff --check` is clean. A localhost Chromium smoke pass at `960 × 540` measured the Party Games root and body at exactly `960 × 540`, with no body overflow and evenly sized wrapped picker cards. The supplied production endpoint was reachable and its catalog was read successfully, but it still served the pre-change API and returned `404` for the new diagnostic route. Therefore the original late-state screenshots are not post-change certification; repeat the diagnostic screenshot matrix after deployment before calling the visual release gate closed.

### Local visual release gate

A post-remediation, read-only Chromium matrix now certifies the local frontend implementation. It covered 28 rendered states: 26 TV views at `960 × 540` and the host and verifier views at `390 × 844`. The matrix includes all Jeopardy presentation phases; every Activity Party and Charades ready, encoded-clue, play, adjudication, verification, and handoff view; Dice and Selector before/after outcomes; tie results; and both phone surfaces.

All 28 frames measured the app root and body at the exact viewport size, with no document scrolling, no interactive element outside the viewport, and no console errors in the final cache-busted captures. The browser harness mocked only read endpoints and rejected session mutations, so it did not create or alter ordinary session data.

Visual inspection of the matrix found and closed five late defects: light-card quiet controls had insufficient contrast, the Activity timer overlaid its canvas, Jeopardy category labels were undersized, long Jeopardy clue text collided with the value/timer and concealed the judged answer, and Activity’s old striped text remained readable without the physical decoder. The corrected Activity clue uses the same color-noise segment grammar as the secret-game family without exposing the clue through accessible text; Final Jeopardy judgment now preserves success/danger button semantics.

The localhost visual gate is closed. Production deployment certification remains open because `10.0.0.10:3111` was still serving the pre-change build during this audit.

Final source gates after the visual corrections: 51 Vitest files / 205 assertions pass, Gaming ESLint completes with zero warnings, the repository parse gate passes, the frontend production build succeeds, and `git diff --check` is clean. The production build still reports existing repo-wide Sass deprecation, static-asset resolution, and chunk-size warnings.
