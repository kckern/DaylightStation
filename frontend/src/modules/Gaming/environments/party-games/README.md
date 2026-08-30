# Party Games Design System

This directory owns the presentation and interaction contract for DaylightStation Party Games. The product is a stylized family entertainment-TV app, not a generic dashboard and not a reskin of the rest of DaylightStation.

This guide is normative for new work. Existing code may predate it; an existing exception is not precedent. Track current deviations in the [Party Games UX audit](../../../../../../docs/_wip/audits/2026-08-30-party-games-ux-audit.md).

Normative words have their usual meaning:

- **MUST** is required for a coherent or usable experience.
- **SHOULD** is the default; depart only for a documented show-specific reason.
- **MAY** is an intentional option.

## Product direction

Party Games should feel like a small family game-show network: immediate, theatrical, tactile, and easy to read across a room. Ordinary events—whose turn it is, a buzzer lock, a score change, a reveal—should feel consequential without making every screen loud.

The visual direction is **broadcast playhouse**:

- A dark studio stage with a controlled focal glow.
- Warm light copy and brass network chrome.
- Tactile controls with shallow physical depth.
- Stable, legible stage geometry.
- Bounded asymmetry in scenic decoration.
- Short bursts of marquee energy at meaningful moments.
- Distinct show identities inside a recognizable network family.

The system is not:

- A Mii/avatar framework or character platform.
- A general runtime theme engine.
- A requirement that every game use an identical layout or palette.
- A license for arbitrary gradients, rotations, glows, or confetti.
- A large component library built ahead of demonstrated reuse.

## Ownership model

The **network layer** owns behavior and visual grammar shared across games:

- Stage bounds, safe areas, spacing rhythm, and responsive containment.
- Control silhouettes, depth, focus, pressed, disabled, and busy states.
- Typography roles and minimum TV-readable sizes.
- Scoreboard, timer, instruction, reveal, handoff, and result semantics.
- Status colors, contrast, motion timing, and reduced-motion behavior.
- The meaning and order of setup, instruction, ready, play, judge, score, handoff, and finish states.

Each **show layer** owns its scenic art direction:

- One dominant scenic hue and one supporting accent.
- One restrained perimeter texture or recurring motif.
- Title treatment and, when justified, a compatible display face.
- Category or round artwork.
- Transition sting and outcome-reveal motif.
- Bounded asymmetry appropriate to the game.

Show styling MUST NOT change focus semantics, control states, status meanings, content containment, safe areas, or the public/private information contract.

## Ownership map for the supported games

Use three ownership levels. Do not force every recurring idea directly into the broadest platform layer.

1. **Party Games network:** invariants that should behave consistently in every show that needs them.
2. **Game family:** a stable pattern shared by two or more related games, but irrelevant to others.
3. **Show:** the mechanic, scenic composition, authored identity, and exceptional behavior that make one game itself.

The current registered presenters are Jeopardy, Activity Party, Charades, Dice, and Selector. Their source locations do not by themselves establish ownership. A component under `platform/ui/` may still be too specialized, while shared behavior may currently be duplicated inside two experience folders.

### Party Games network responsibilities

These belong to the Party Games environment or its shared UI layer:

| Concern | Platform contract | Show-controlled portion |
|---|---|---|
| Stage shell | Frame containment, safe areas, overflow policy, layer ordering, and known chrome regions | Scenic backdrop, title plate, perimeter motif, and focal-stage arrangement |
| Session flow | Loading, recoverable error, setup, resume, play, terminal result, replay, and exit behavior | Show-specific phases between play and terminal result |
| Controls | Button construction, focus, press, selection, disabled, busy, danger, input parity, and minimum targets | Label, priority, placement, and rare show-specific silhouette variant |
| Player identity | Team/member names, avatars, accessible color handling, active/locked semantics | Scenic framing and how dramatically the current actor is introduced |
| Score | Score data, ordering semantics, active team, negative-score treatment, change feedback, and final ranking | Board placement, show vocabulary, score-change sting, and whether scoring exists |
| Time | Countdown behavior, expiry semantics, warning threshold, reduced motion, and readable numeric treatment | Placement, size, duration, and show-specific warning sting |
| Instruction | Goal, actor, control, equipment, ready boundary, skip/repeat affordance, and TV-readable copy | Authored rules, diagrams, examples, and show voice |
| Reveal/outcome | Pending versus committed truth, correct/incorrect/pass semantics, feedback duration, and stable outcome state | What is revealed, scenic animation, and show-specific ceremony |
| Handoff | Explicit next actor/team, controller ownership, and device responsibility | Show copy and transition motif |
| Public/private split | Surface authorization, conceal/reveal rules, verifier responsibility, and QR/join behavior | The secret content and game-specific concealment method |
| Media/resilience | Loading/failure boundary, fallback, containment, and truthful diagnostics | Renderer, media art direction, and mechanic-specific fallback appearance |
| Effects/audio | Cue policy, priority, interruption, mute, reduced-motion pairing, and effect-safe regions | A show’s cue samples, transition sting, and reveal motif |

Not every show must render every shared primitive. Dice does not need a scoreboard; Selector does not need a timer. “Platform-wide” means the contract is shared whenever the concern exists, not that the UI must appear everywhere.

### Game-family patterns

Family patterns should share semantics and behavior while allowing different scenery.

#### Timed performance round: Activity Party and Charades

These games share a real domain pattern:

```text
performer ready → private clue → timed performance → adjudication
                → optional verification → score → handoff
```

The family layer should own:

- Performer/active-team framing.
- Secret-ready and room-ready boundaries.
- Countdown and expiry behavior.
- Correct, incorrect, and pass adjudication.
- Optional opponent/verifier confirmation.
- Challenge-complete and next-performer handoff.
- The stable placement responsibilities for actor, timer, action, and scoreboard.

Activity Party retains drawing, decoder content, drawing checkpoints, its mixed draw/act rotation, and its more playful craft-show treatment. Charades retains segmented secret text, its no-talking rule, its simpler stage, and its own clue pacing. A family primitive must not become a conditional mega-component with `isDrawing`, `isDecoder`, and `isCharades` branches.

Good extraction candidates are a small `PerformanceRoundFrame`, `AdjudicationActions`, or shared phase-to-copy helpers after the two screens have been visually reconciled. Keep the actual activity renderer as a child/slot owned by the show.

#### Committed random outcome: Dice and Selector

Dice and Selector both choose inputs, commit a random outcome through the authoritative session, present an immediate result, and permit another commit. The family layer may eventually share:

- Pending/committing control behavior.
- A stable outcome-reveal boundary.
- Replay/re-pick language and error recovery.
- A short reveal-then-readable-result motion contract.

They should not share their primary composition. A polyhedral roll and a person spotlight have different content, spatial needs, and ceremony. Do not create a generic “randomizer screen” until another repeated semantic need proves it useful.

### Show ownership matrix

| Show | Reuses from network | Must remain show-owned | Scenic direction |
|---|---|---|---|
| **Jeopardy** | Stage containment, title card, scoreboard, timer, reveal panel, media fallback, control legend, team/buzzer state, results | Category board, clue/value grid, cursor navigation, Daily Double, wagers, hosted/turn modes, Final Jeopardy, dollar vocabulary, board-fill sequence | Rigid broadcast architecture; deep blue wells, brass values, crisp grid, restrained high-stakes reveals |
| **Activity Party** | Performer identity, scoreboard, timer, title/ready states, adjudication, verifier flow, handoff, drawing-device normalization and persistence services | Draw-versus-act challenge rotation, decoder presentation, drawing canvas/tools/checkpoint UX, activity-specific aids and authored challenge content | Looser creative-studio energy; paper/craft or decoder motif; bounded asymmetry around a stable play surface |
| **Charades** | Performer identity, scoreboard, timer, ready state, adjudication, optional verification, handoff | Secret-clue staging, segmented clue treatment, silent-performance rules, clue-specific pacing | Minimal theatrical stage; spotlight and cue-card energy; high contrast with less apparatus than Activity Party |
| **Dice** | Stage shell, control states, pending/error truth, input parity, optional-renderer failure boundary, outcome timing | Dice notation, preset semantics, custom-roll input, polyhedral geometry, WebGL/fallback rendering, roll physics, total calculation and roll choreography | Tabletop spectacle; brass physical objects, dark felt/well, strong central result, minimal surrounding chrome |
| **Selector** | Stage shell, member avatars, selection/disabled states, authoritative commit, error recovery, outcome timing | Candidate inclusion grid, selection population rules, picked-person spotlight, pick-again behavior | Casting-call or prize-draw energy; portrait/name prominence, clear inclusion state, one decisive winner reveal |

### Existing component classification

This is the intended design ownership of current building blocks:

| Component or service | Intended owner | Notes |
|---|---|---|
| `PartyGamesApp`, `TeamSetup`, `PartyGamesResults` | Party Games network | Shell flow, setup, and terminal ceremony should not be restyled independently per show. |
| `PartyGamesHost`, `PartyGamesVerifier` | Party Games network | Private control and adjudication surfaces share behavior; show color may identify context without changing semantics. |
| `BuzzerArbiter`, `useBuzzers` | Party Games network | Input arbitration is platform behavior. Jeopardy owns when its rules arm the buzzer. |
| `AudioCueEngine`, `EffectPolicyRunner`, `EffectOverlay` | Party Games network | Policy and safe rendering are shared; actual cues and scenic effects are show-owned. |
| `TitleCard`, `MemberAvatar`, `Scoreboard`, `TimerRing`, `ControlLegend` | Party Games network | Shared semantic primitives with limited scenic variants. |
| `RevealPanel`, `MediaCluePlayer`, `OptionalRendererBoundary` | Party Games network | Shared containment and truth/fallback behavior; content and show treatment remain local. |
| `SegmentedSecretText`, `ImageDecoderDisplay` | Performance/secret game family | Their current `platform/ui/` location should not imply use by unrelated shows. Promote more broadly only if another family proves the same semantics. |
| `WagerPanel`, `Board`, `ClueScreen`, `FinalRound` | Jeopardy | Their vocabulary and phase behavior are intrinsic to the show. |
| `DrawingCanvas`, `DecoderPresenter` | Activity Party | Input adapters/checkpoint services may be shared; the creative tool and decoder UX are show mechanics. |
| `PolyhedralDice`, dice geometry/model | Dice | Rendering resilience is shared, but the renderer and roll choreography are not. |
| Candidate grid and winner spotlight | Selector | Member identity is shared; candidate population and reveal composition are show-specific. |

### Ownership decision test

Before moving a design or component into a shared layer, ask:

1. **Same meaning?** Do the games share semantics and state behavior, not merely a visual resemblance?
2. **Same failure contract?** Do loading, disabled, error, retry, focus, and reduced-motion states behave the same way?
3. **Show vocabulary absent?** Could the API be named without words such as clue, wager, die, drawing, or candidate?
4. **Real reuse?** Is the pattern used by at least two experiences today?
5. **Variation through composition?** Can show-owned content enter through a small child/slot or semantic variant rather than many boolean props?
6. **Independent improvement?** Would fixing the shared implementation improve every consumer without forcing visual sameness?

If the answer to the first two questions is no, keep it show-specific. If only the appearance matches, share tokens rather than markup. If semantics match but scenery differs, share headless behavior or a structural primitive and leave art direction to the show.

## Source of truth

Shared Party Games tokens and mixins currently live in:

- [`platform/ui/_tokens.scss`](../../platform/ui/_tokens.scss)
- [`platform/ui/components.scss`](../../platform/ui/components.scss)
- [`platform/ui/Scoreboard.scss`](../../platform/ui/Scoreboard.scss)

Reusable behavior and presentation primitives live in `platform/ui/`. Environment flow and shared surfaces live in this directory. Show-specific composition lives under `experiences/<show>/`.

### Import aliases

Party Games code MUST use the Gaming aliases once an import crosses out of its local feature folder:

```js
import { fetchSession } from '@gaming/platform/api/sessionClient.js';
import GameButton from '@gaming-ui/GameButton.jsx';
```

- `@gaming` resolves to `frontend/src/modules/Gaming`.
- `@gaming-ui` resolves to `frontend/src/modules/Gaming/platform/ui`.
- Relative imports remain appropriate for siblings inside one experience or one environment folder.
- Do not climb through `../../../` to reach Gaming platform code. Both Vite and Vitest define the aliases, and `platform/ui/alias.test.js` protects the test-runner contract.

Rules:

1. Raw presentation palette values MUST be declared in the token source, not scattered through component styles. Dynamic team colors are the exception and remain centralized in `teamColors.js` because they are authored data with computed contrast, not scenic CSS.
2. Repeated semantic roles MUST use custom properties or shared primitives.
3. Stable presentation MUST NOT be placed in React inline styles. Inline styles are reserved for genuinely dynamic data such as team color, measured geometry, and progress.
4. Show overrides MUST be grouped on the show root, not distributed among descendants.
5. Promote a pattern to `platform/ui/` only after it is genuinely shared. Similar-looking one-off scenic compositions should remain show-owned.
6. Do not build a runtime theme registry, theme loader, or generalized framework merely to hold a handful of CSS variables. A presenter registry keyed by experience ID is appropriate where behavior—not just color—actually differs.

## Core palette

The current navy, warm ivory, and brass palette is the network baseline.

| Role | Current token | Usage |
|---|---|---|
| Studio stage | `--gp-stage` | Viewport background and darkest scenic field |
| Focal stage light | `--gp-stage-glow` | One broad glow behind the current focal region |
| Deep well | `--gp-well` | Inset board or media wells |
| Raised surface | `--gp-surface` | Controls and restrained overlays |
| Quiet keyline | `--gp-surface-border` | Ordinary surface boundaries |
| Primary copy | `--gp-paper` | High-priority readable content |
| Secondary copy | `--gp-paper-dim` | Supporting copy that still passes contrast |
| Dark ink | `--gp-ink` | Copy on light/brass faces |
| Network accent | `--gp-brass` | Primary action, score emphasis, and show chrome |
| Highlight accent | `--gp-brass-bright` | Focus and lit edge, not a second competing accent |
| Danger | `--gp-danger` | Error, destructive action, and expiry only |
| Negative number | `--gp-negative` | Negative scores without implying a system error |

Color rules:

- A screen SHOULD have one dominant accent. A show MAY add one supporting scenic accent.
- Team colors are data, not general UI colors. Pair them with a team name, position, avatar, shape, or label.
- Team colors MUST NOT replace danger, success, focus, disabled, or selection semantics.
- Long prompt text MUST sit on a stable, high-contrast surface rather than directly on saturated scenery.
- Do not introduce a generic purple-to-blue gradient as a substitute for art direction.
- Never communicate state by color alone.

When the first show-specific theme contract is implemented, start with only the scenic slots the shows actually need—for example stage, stage glow, scenic accent, title plate, ornament, and reveal effect. Keep system status and focus tokens outside show control.

## Typography

The baseline roles are:

| Role | Family | Content |
|---|---|---|
| Display | `--gp-font-display` (`Anton`) | Short show titles, categories, scores, clocks, and large numerals |
| Prompt | `--gp-font-serif` (`Bitter`) | Clues, prompts, answers, and readable instruction copy |
| Utility | `--gp-font-ui` | Buttons, setup, companion controls, metadata, and system messages |

Typography rules:

- A local composition SHOULD use no more than two type roles.
- Display type MUST NOT be used for paragraphs or long instructions.
- All caps is reserved for short labels, categories, rounds, and status calls.
- Prompts SHOULD use sentence case, comfortable line height, and a controlled measure.
- Large scores and timers SHOULD use stable-width or tabular numerals when changing width would cause jitter.
- Headings MAY use balanced wrapping. Critical instructions and actions MUST remain readable with natural wrapping.
- Do not shrink text until it fits. Change composition, shorten authored copy, or provide intentional scrolling.
- A show MAY replace the display face, but its prompt and utility faces SHOULD remain stable.
- Do not add outline, glow, shadow, gradient fill, and extrusion to the same text treatment.

## Geometry and spacing

Functional geometry stays stable. Scenic geometry provides personality.

- Controls MUST remain level and aligned.
- Text baselines, score columns, boards, and action rows MUST remain geometrically stable.
- Use a small radius family: tight controls, medium cards, and larger scenic frames.
- Use one signature asymmetry at a time: clipped corner, offset backing plate, angled rule, corner badge, or deliberately uneven scenic frame.
- Choice cards MAY alternate a visual tilt up to approximately `0.75deg` when it cannot disturb wrapping, hit targets, or focus bounds.
- Functional buttons MUST NOT receive random rotations.
- Avoid organic blobs unless a show has a specific, repeated reason for them.

Prefer the spacing rhythm already common in the module: `0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`, and `3rem`. New intermediate values require a layout reason, not visual guesswork.

## Stage composition

Every state should read from ten feet away within about two seconds. A viewer should be able to identify:

1. What game and round are active.
2. What the room must do now.
3. Which player or team acts.
4. How much time remains, if timed.
5. What happened after an action.
6. What happens next.

A game may compose the following zones differently, but their responsibilities must remain clear:

```text
┌──────────────── show / round identity ────────────────┐
│ score / actor status                                  │
│                                                      │
│                 PRIMARY PLAY STAGE                   │
│          prompt, board, media, or reveal             │
│                                                      │
│ timer / state             instruction / next action  │
└──────────────────────────────────────────────────────┘
```

Composition rules:

- There MUST be one dominant game fact per state.
- Persistent chrome MUST be quieter than the current prompt, board, or reveal.
- Scoreboards, timers, QR codes, and effects MUST receive allocated space or a proven non-overlapping overlay region.
- An unused zone MUST collapse so the primary stage can expand.
- TV-stage children MUST size against the owned frame, not the browser viewport. Avoid `vh` inside the embedded TV frame.
- The baseline TV frame is `960 × 540`; validate additional supported sizes without changing the hierarchy.
- The TV surface MUST NOT develop accidental body scrolling or horizontal overflow.
- Intentional internal scrolling needs a visible boundary and must not hide the primary action.
- Dynamic names, scores, and labels must have explicit wrap, truncate, or scale behavior.
- Companion-phone pages may use viewport sizing because they own the page, but sticky actions must not cover content or safe areas.

## Controls

### Button construction

Buttons should feel tactile, not glossy:

- Medium-radius rectangular face.
- Shallow top or top-left highlight.
- Darker bottom edge or `2–4px` offset backing plate.
- One consistent light direction across the product.
- Clear high-contrast label.
- On press, approximately `2px` downward movement and a collapsed extrusion.

Primary and buzzer actions MAY be larger or rounder. Secondary buttons MUST remain visually quieter. Destructive actions use danger semantics and do not borrow the celebratory brass treatment.

Avoid:

- Pill-shaped treatment for every action.
- Deep bevels, wet gloss, faux chrome, or inconsistent light directions.
- Slightly different custom buttons on every screen.
- Decorative rotation on primary, destructive, or navigation controls.

### Required states

Every interactive control MUST define, as applicable:

- Default.
- Hover for pointer devices.
- `:focus-visible` with a separate high-contrast ring.
- Pressed/active.
- Selected or `aria-pressed`.
- Disabled.
- Busy/pending.
- Error or destructive.

Focus is not selection. Selection is not a team-color border. Pressed is not only an animation.

All controls MUST preserve their accessible name and semantics across TV keyboard/gamepad, pointer, and companion touch input. Touch targets should be at least `44 × 44px`; important living-room controls should be larger.

## Borders, depth, gradients, and texture

### Borders

- Ordinary surfaces: `1px` quiet keyline.
- Selected or reveal state: `2px` accent keyline plus a non-color cue.
- Keyboard/gamepad focus: separate `3px` high-contrast ring with offset.
- Team identity: stripe, badge, avatar ring, or named plate rather than a full competing border system.
- Decorative double rules, bulbs, dashes, and ticket perforations belong to scenic frames only.

### Depth

- Use shallow raised depth for actionable controls and score/name plates.
- Use flat or softly inset treatment for prompts, media wells, and ordinary panels.
- Shadows describe hierarchy; they do not compensate for weak spacing or contrast.
- One light direction applies everywhere: lighter top/left and darker bottom/right.

### Gradients

- A tactile face MAY use one restrained vertical gradient within a single hue family.
- The stage MAY use one broad radial glow behind the focal content.
- A show MAY add one controlled scenic wash if readable content remains on a stable surface.
- Do not apply gradients independently to every card, border, heading, and button.

### Texture and ornament

Each show MAY use one low-opacity perimeter motif—halftone, rays, curtains, studio panels, light grid, paper cutout, or similar. Keep prompt and control interiors quiet.

Do not stack confetti, sparkles, glass blur, glow, grain, stickers, and patterned borders as a default look. Ornament should reveal show identity or mark an event.

## Motion and effects

Motion communicates causality and state change, then stops.

| Event | Target treatment |
|---|---|
| Button press | `70–100ms` downward compression |
| Focus/navigation | Immediate ring; optional `100–140ms` luminance or scale settle |
| State entrance | `180–260ms` fade with `8–16px` directional travel |
| State exit | `120–180ms`, faster than entrance |
| Prompt/reveal | `300–500ms` staged reveal |
| Score change | Number tick/slide and brief team-color flash, `300–600ms` total |
| Buzz lock | Immediate freeze, owner label, and impact finishing within `400ms` |
| Timer warning | One threshold transition followed by stable urgency |
| Final result | `1–2s` celebration followed by a stable result screen |

Rules:

- A command MUST show immediate accepted, pending, rejected, or locked feedback.
- Looping pulses MUST NOT be the normal way to indicate focus, active team, or timer urgency.
- Blinking bulbs or crawling/chasing borders are ceremony effects only.
- Chasing effects MAY appear for ready, buzz-lock, reveal, or winner moments and MUST stop after about two cycles or `1.5s`.
- Prompt text, scores, navigation, and the full viewport MUST NOT blink.
- Avoid flashes faster than `3Hz`.
- Confetti or celebration effects MUST not obscure the stable outcome.
- Audio and motion may reinforce an event but cannot be its only signal.
- `prefers-reduced-motion` MUST replace travel, pulse, and chase with an immediate static keyline, luminance change, icon, or label. Reducing duration to nearly zero is insufficient if meaning disappears.

## State choreography

Games SHOULD use the following shared rhythm where applicable:

```text
gather → explain → ready → reveal → play → judge → score → handoff → finish
```

Not every game needs every state, but each transition must answer “what changed?” and “what do we do now?”

- **Gather:** identify players, teams, devices, and required equipment.
- **Explain:** show the goal, active actor, control, and win condition with minimal text.
- **Ready:** give the room a deliberate start boundary.
- **Reveal:** expose only the information appropriate to each surface.
- **Play:** preserve prompt, actor, timer, and current input state.
- **Judge:** clearly separate a proposed result from a committed result.
- **Score:** connect cause to score change.
- **Handoff:** name the next actor and controller/device responsibility.
- **Finish:** provide ceremony, stable rankings, and clear replay/exit actions.

Loading, empty, disconnected, retry, skipped, tie, and error paths require the same visual care as the happy path.

## Public and private surfaces

The TV is the shared stage. A phone or verifier surface is a private controller or adjudication surface.

- Public prompts, timing, score, actor, and committed outcomes belong on the TV.
- Secrets, answers awaiting reveal, host controls, and verifier decisions belong on the appropriate private surface.
- Private information MUST NOT be mirrored onto the TV merely because it is convenient to render.
- A physical decoder or private device state MUST tell the room who may look and when.
- An encoded clue MAY appear on the TV only when the encoding is the mechanic, plainly identifies the intended viewer, does not expose the secret as readable DOM or accessible text, and is replaced by a locked state when play begins.
- Companion controls SHOULD favor clarity, reachability, and response speed over scenic decoration.
- TV and companion surfaces should feel related through color roles, type, and control behavior, not through identical layouts.

## Shared primitives

Prefer or evolve existing primitives for repeated responsibilities:

- `PartyStage`
- `ShowHeader`
- `InstructionCard`
- `StageActions`
- `GameButton`
- `OutcomeReveal`
- `CompanionPanel`
- `TitleCard`
- `Scoreboard`
- `TimerRing`
- `RevealPanel`
- `ControlLegend`
- `MemberAvatar`
- `MediaCluePlayer`
- Shared tokens, button mixins, and team-color helpers

Future shared patterns should be promoted only after their semantics and composition repeat across games. Do not make a generic component solely because two boxes look similar.

## Writing style

- Use direct room language: “Jordan draws,” “Team Blue guesses,” “Pass the controller to Sam.”
- Prefer one short instruction plus one supporting detail.
- Name the actor and action; avoid vague labels such as “Continue” when “Reveal answer” is available.
- Use consistent verbs for the same state changes.
- Keep machine or session terminology out of player-facing copy.
- Do not use breathless filler such as “Get ready for an EPIC experience!”
- Humor belongs to authored game content, not generic system messages.

## AI-slop rejection rules

Reject a screen or change when it relies on any of the following:

- Generic purple/blue gradients without a scenic or semantic reason.
- Random card tilts, mismatched radii, or decorative blobs.
- Gratuitous sparkles, confetti, glow, glass blur, and grain used together.
- Emoji as substitute icons or category art.
- Oversized headings repeated above already-obvious content.
- Every surface placed inside a rounded card.
- Multiple equally loud accent colors.
- Pulsing or floating elements with no state meaning.
- Unmodeled theme changes made from scattered literals.
- Placeholder-sounding copy, fake excitement, or unnecessary explanatory subtitles.
- A visually elaborate transition that hides what state actually changed.

The test is not whether a treatment is fashionable. It is whether it communicates this show, this moment, or this interaction.

## Future board-game boundary

The network design system is expandable to a Monopoly-like economic board game, but the current Party Games abstraction is not—and should not pretend to be—a general board-game engine. Reuse the presentation grammar and session lifecycle. Add the gameplay ontology as a versioned experience family only when a real board game requires it.

| Board-game concern | Existing platform responsibility | Future game-family responsibility |
|---|---|---|
| Board and spaces | Bounded stage, zoom/overflow policy, focus, labels, and public/private surfaces | Graph or track topology, space identity, traversal, ownership overlays, and space actions |
| Pieces | Member/team identity, accessible colors, selection and active-state semantics | Piece position, movement legality, stacking, collision/offset rules, and movement events |
| Dice | Authoritative random commit, pending/error feedback, and outcome reveal | Roll-to-movement interpretation, doubles, extra turns, and jail rules |
| Cards and decks | Card/reveal containment, private/public assignment, and motion grammar | Deck order, draw/discard state, card effects, retention, and secrecy rules |
| “Pass Go” rules | Cause-to-outcome feedback and score/economy display primitives | Path-crossing events, salary award, rule exceptions, and audit history |
| Houses and hotels | Reusable piece/badge layering and readable counts | Supply, build/sell legality, upgrade state, rent schedule, and monopoly checks |
| Money and trades | Stable numeric display, confirmations, error states, and private controls | Ledger, transfers, mortgages, auctions, trades, bankruptcy, and atomic transactions |
| Turns and phases | Session resume, actor/handoff language, terminal results, and companion capabilities | Turn order, phase machine, interrupts, pending choices, and win conditions |

When that need arrives, introduce a versioned capability such as `economic-board@1` behind the normal experience manifest. It may define board topology, pieces, decks, an economy, and legal actions, while continuing to consume Party Games primitives for stage layout, controls, focus, instructions, outcomes, companions, audio, and results.

The architectural test is simple:

- If changing the concept could change who legally owns money or where a piece may move, it belongs in the game rules/runtime.
- If changing it only changes how that truth is framed, focused, announced, animated, or controlled, it belongs in the Party Games presentation system.
- Do not add generic `Board`, `Piece`, `Deck`, or `Economy` platform components before at least two real experiences prove the same semantic contract.

## New-show checklist

Before registering a new Party Games experience, verify:

- [ ] The show has a one-sentence visual premise and a defined emotional tone.
- [ ] It declares no more than one dominant scenic hue, one supporting accent, and one recurring motif.
- [ ] Shared status, focus, team, and control semantics remain intact.
- [ ] Every state has one dominant fact and one clear next action.
- [ ] Setup requests only information this game needs.
- [ ] Instructions identify the goal, actor, control, and completion condition.
- [ ] Public and private information are assigned intentionally.
- [ ] Buttons implement the complete interaction-state contract.
- [ ] Prompt, score, timer, and active actor are legible from ten feet away.
- [ ] Long names, maximum teams/items, missing media, and large scores do not overflow.
- [ ] The `960 × 540` stage does not body-scroll, clip, or hide controls.
- [ ] Companion controls fit a representative phone viewport and remain reachable.
- [ ] Motion follows the timing grammar and has a meaningful reduced-motion replacement.
- [ ] Loading, empty, disconnected, error, retry, tie, skipped, and terminal states are handled.
- [ ] Winner and tie states provide a stable result after their celebration.
- [ ] New literals or primitives are justified rather than duplicating an existing role.
- [ ] The result does not trigger the AI-slop rejection list.
- [ ] Cross-feature imports use `@gaming` or `@gaming-ui`; no new Gaming-relative-path ladder was introduced.
- [ ] New mechanics remain in the experience or a proven game-family layer rather than leaking into the network presentation contract.

## Review standard

Review Party Games with the project’s [design-system quality rubric](../../../../../../docs/_wip/audits/2026-08-30-design-system-quality-rubric.md). A review must include rendered evidence at the TV and phone targets, content stress states, supported input methods, reduced motion, and source checks. Reading the happy-path JSX alone is not sufficient.
