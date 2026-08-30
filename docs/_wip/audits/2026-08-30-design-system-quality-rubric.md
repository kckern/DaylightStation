# Design System Quality and Adherence Rubric

## Purpose

Use this rubric to evaluate both:

1. **Design-system quality:** whether the system itself is coherent, complete, usable, accessible, and governable.
2. **Implementation adherence:** whether a product surface uses that system faithfully and still delivers a good experience in real states and viewports.

These are separate questions. A strong system can have a low-adherence implementation; a consistent implementation can faithfully reproduce a weak system. Report both subscores before the combined score.

The rubric is aesthetic-direction neutral. It does not require every product to look alike. It requires visual and interaction decisions to be intentional, semantic, reusable, and consistent with the declared direction.

### Product-owned systems and theme families

Adherence does **not** mean every DaylightStation app must inherit one generic visual skin. A product may and often should own a specialized design system when its context has distinct needs. An entertainment TV app, school worksheet, media player, and administrative console should not be forced into the same composition or personality.

Grade a product against the nearest intentional system that owns it. Then verify that this subsystem has a defined relationship to platform requirements such as accessibility, input, safe areas, and shared infrastructure.

A product-owned system may support multiple theme families. Variation is healthy when:

- The shared layer owns behavior, geometry, semantics, accessibility, and recurring chrome.
- Theme packs own art direction: palette, display face, texture, scenic treatment, stings, and show-specific motion.
- Theme values enter through declared semantic tokens or component variants.
- A theme cannot remove required focus, contrast, state, input, or containment behavior.

Do not deduct points merely because sibling experiences look different. Deduct points when the differences are unmodeled, hard-coded, inconsistent inside a show, or bypass shared behavioral contracts.

This does not imply a runtime theme engine, character platform, or large component framework. For a focused app, the “system” may be a documented token contract, a small set of stage primitives, and repeatable screen-state patterns. Build only what the games actually share.

## Score summary

| Section | Weight |
|---|---:|
| A. Design-system quality | 40 |
| B. Implementation adherence | 60 |
| **Total** | **100** |

Score each criterion from 0–4, then multiply by its weight divided by 4:

```text
criterion points = criterion weight × rating ÷ 4
```

Keep one decimal place while scoring and round only the final total.

### Rating anchors

| Rating | Meaning | Evidence pattern |
|---:|---|---|
| 4 | Exemplary | Complete, intentional, documented or self-evident, consistently applied, and verified in representative states |
| 3 | Sound | Clear system with minor gaps or isolated drift; no material user harm |
| 2 | Mixed | Partial coverage or repeated inconsistency; users notice seams, but core use remains viable |
| 1 | Weak | Mostly ad hoc or frequently bypassed; important states, inputs, or surfaces fail the contract |
| 0 | Absent/broken | No meaningful system, or the criterion is unusable in core flows |

Ratings must be supported by observed UI plus source evidence. Do not award a 4 based on token or component files that the shipped screens do not use.

## Non-negotiable gates

Evaluate these before assigning a grade. A gate failure caps the overall result even if the weighted arithmetic is higher.

| Gate | Pass condition | Score cap when failed |
|---|---|---:|
| G1. Core operability | Every primary flow can be completed at supported viewports without clipped, hidden, overlapped, or unreachable controls | 59 |
| G2. Accessible operation | Supported non-pointer input has visible focus and semantic operation; critical text/control contrast passes; essential meaning is not color-, sound-, hover-, or motion-only | 69 |
| G3. State completeness | Loading, empty, error, offline, disabled, busy, success, and terminal states exist where applicable and provide an actionable next step | 69 |
| G4. Responsive containment | No material horizontal overflow, accidental body scrolling, unreadable wrapping, or zero-height content at declared target sizes and 200% text | 69 |
| G5. Truthful feedback | The UI never shows a control that does nothing, a value such as `NaN`, false progress, stale success, or an uncommitted result as committed | 49 |

Caps are cumulative only in the sense that the lowest applicable cap wins. Record each failure; do not subtract additional arbitrary points for the same defect unless it also independently harms a scored criterion.

## A. Design-system quality — 40 points

### A1. Product direction and design principles — 6 points

Evaluate whether the system defines an ownable visual and interaction direction rather than merely listing colors.

Evidence of quality:

- A concise statement of product character and intended emotional tone.
- Principles that guide hierarchy, density, material treatment, motion, and input behavior.
- Direction appropriate to the context: TV at distance, touch, desktop, print, kiosk, or mixed surfaces.
- A recognizable identity that does not depend on a logo or one accent color.
- Clear boundaries for legitimate sub-themes and data-derived colors.

Failure signals:

- “Dark background + bright accent” is the entire direction.
- Screens invent unrelated gradients, shadows, radii, or type treatments.
- The system describes implementation primitives but gives no decision guidance.

### A2. Semantic token architecture — 8 points

Evaluate the naming, completeness, layering, and correctness of tokens.

Evidence of quality:

- Tokens express roles such as surface, elevated surface, text, muted text, border, focus, success, warning, danger, and selection—not component-specific colors alone.
- Primitive values and semantic aliases are separated when the system’s scale warrants it.
- Typography, spacing, sizing, radius, elevation, opacity, motion, and z-index are tokenized where repetition or consistency matters.
- Themes and surface variants preserve semantic meaning.
- Undefined tokens, circular aliases, near-duplicate values, and fallback chains are detected.
- Data-derived values are explicitly distinguished from system tokens.

Failure signals:

- Magic hex values and pixel values dominate feature styles.
- Tokens are named by appearance (`blue-2`) where intent (`action-primary`) is required.
- A token file exists, but primary screens redefine parallel palettes.
- Components reference nonexistent variables or silently fall back to unrelated colors.

### A3. Foundation scales and composition rules — 5 points

Evaluate whether the system supplies coherent foundations for composing screens.

Evidence of quality:

- Deliberate type scale, line heights, measure, number treatment, and font roles.
- Spacing and sizing scales with a manageable number of steps.
- Radius, border, shadow, and elevation scales with defined purposes.
- Grid/container rules, content widths, safe areas, density modes, and target viewport contracts.
- Wrapping, truncation, scrolling, and long-content policies.

Failure signals:

- Arbitrary spacing/radii accumulate across components.
- `height: 100%` is used without a documented containing-block contract.
- The system has components but no page/stage composition model.

### A4. Primitive and component coverage — 8 points

Evaluate whether shared building blocks cover recurring product needs without becoming a giant inflexible component library.

Evidence of quality:

- Controls: buttons, icon buttons, fields, selection controls, menus, and navigation.
- Structure: page/stage shells, panels, cards, headers, footers, grids, and scroll regions.
- Feedback: loading, empty, error, offline, progress, toast/banner, confirmation, and results.
- Domain primitives for repeated high-value patterns.
- Components expose semantic variants and composition slots rather than copy-pasted forks.
- Escape hatches are narrow, documented, and do not require restyling the component from scratch.

Failure signals:

- Browser-default controls appear beside designed controls.
- Every screen authors its own button, card, modal, or status banner.
- “Shared” components are so rigid that features routinely bypass them.

### A5. Component state and accessibility contract — 8 points

Evaluate whether primitives define behavior, not only appearance.

Evidence of quality:

- Default, hover, focus-visible, pressed, selected, disabled, busy, invalid, success, and destructive states where applicable.
- Touch target, TV-distance legibility, pointer, keyboard, gamepad/remote, and screen-reader behavior appropriate to supported surfaces.
- Accessible names, roles, values, relationships, announcements, and error association.
- Contrast targets and color-independent state cues.
- Reduced-motion behavior preserves meaning rather than merely setting animation duration to zero.
- Focus order, focus restoration, and modal/sticky-layer behavior are specified.

Failure signals:

- Interaction states are left to browser defaults.
- Hover and focus are visually indistinguishable.
- Animation or color is the only indication of state.
- A reusable visual control has no semantic interaction model.

### A6. Documentation, governance, and evolution — 5 points

Evaluate whether the system can remain coherent as multiple contributors change it.

Evidence of quality:

- Usage guidance, examples, accessibility notes, and “when not to use” guidance.
- Named ownership and a review path for new tokens, components, or variants.
- Deprecation/migration policy and versioned breaking changes where appropriate.
- Automated detection for undefined tokens, forbidden raw values, duplicate primitives, or visual regressions.
- A discoverable changelog or decision record for material system changes.

Failure signals:

- Rules exist only in comments no test enforces.
- New variants are added ad hoc to unblock one screen.
- Dead tokens/components and near-duplicates accumulate without a removal path.

## B. Implementation adherence — 60 points

### B1. Token adoption and semantic use — 9 points

Evaluate whether the audited surface uses the system’s tokens correctly.

Check:

- Raw color, spacing, radius, shadow, type, and motion values are absent unless explicitly data-derived or documented exceptions.
- Semantic tokens match the meaning of the UI state.
- No undefined variables, accidental fallbacks, parallel feature palettes, or copied token values.
- Inline styles are limited to genuinely dynamic values such as geometry, progress, or team identity.
- Light/dark/high-contrast themes continue to work because semantic roles were preserved.

A surface cannot score above 2 if it defines a parallel palette for ordinary system roles.

### B2. Primitive reuse and variant discipline — 9 points

Evaluate whether the surface composes approved primitives rather than recreating them.

Check:

- Recurring controls, cards, status states, overlays, typography, and navigation use shared primitives.
- Variants represent semantic differences, not screen-specific decoration.
- Feature wrappers do not undo base spacing, focus, disabled, or accessibility behavior.
- Repeated markup/style patterns are promoted only when they are genuinely stable and shared.
- No browser-default control appears accidentally.

A surface cannot score above 2 when the same control pattern is independently implemented three or more times.

### B3. Layout, space, balance, and responsive containment — 8 points

Evaluate the actual composition at every declared surface and content stress case.

Check:

- The primary task receives the visual and spatial priority.
- Space is intentional: neither cramped nor dominated by unexplained empty regions.
- Persistent chrome reserves space instead of obscuring content.
- Wrapping, truncation, and scrolling are deliberate and discoverable.
- Long names, localization, dynamic counts, missing media, 200% text, safe areas, and orientation changes remain usable.
- No clipped controls, accidental body scroll, overlapping layers, or zero-height flex/grid children.
- TV content remains legible at distance; phone controls remain reachable and at least the declared target size.

### B4. Typography and information hierarchy — 6 points

Evaluate whether type communicates structure and reading order.

Check:

- Display, heading, body, label, caption, code/data, and numeric roles use the declared type system.
- One primary focal point exists per state.
- Size, weight, placement, and contrast agree about importance.
- Line length, wrapping, casing, tracking, and numeral alignment fit the content.
- Headings do not repeat the same information or overwhelm actionable content.
- Dynamic text and localization do not break the hierarchy.

### B5. Color, contrast, and visual-state fidelity — 6 points

Evaluate whether color is both system-consistent and functionally correct.

Check:

- Text and controls meet the project’s declared contrast target in every state.
- Selection, focus, disabled, warning, error, and success remain distinguishable without color alone.
- Accent colors retain their reserved meanings.
- Team/category/data colors do not collide with system status colors.
- Gradients, shadows, transparency, and texture improve hierarchy rather than add noise.
- Images, canvas, SVG, and overlays fit the same material and contrast vocabulary.

### B6. Interaction states and input parity — 7 points

Evaluate complete, truthful control behavior across supported inputs.

Check:

- Every interactive element has visible default, focus-visible, active/pressed, disabled, and busy feedback as applicable.
- Pointer, keyboard, touch, gamepad/remote, and companion controls reach equivalent outcomes where promised.
- Focus order and default focus are safe; destructive actions are not easy to trigger accidentally.
- Commands prevent duplicate submission and expose pending/accepted/rejected state.
- Controls never appear operable when they are no-ops.
- Back, cancel, retry, undo, and exit exist where the flow requires them.

### B7. Accessibility semantics and assistive feedback — 7 points

Evaluate the implemented DOM/interaction semantics, not just visual accessibility.

Check:

- Native elements or correct roles are used for controls, collections, grids, progress, timers, and status.
- Accessible names and values describe the action/result, not implementation details.
- Dynamic updates are announced with appropriate urgency and without chatter.
- Images/media have useful alternatives or are correctly decorative.
- Errors are associated with the affected control and receive focus/announcement when needed.
- Zoom, text scaling, reduced motion, and high-contrast preferences remain functional.
- Color, motion, audio, hover, and spatial position are never the sole carrier of essential meaning.

### B8. Motion, transitions, and feedback — 4 points

Evaluate motion as communication rather than decoration.

Check:

- Transitions explain navigation, reveal, causality, score/state change, handoff, or completion.
- Durations/easing come from the system and feel coherent across screens.
- Loading and command latency have honest feedback.
- Infinite motion is rare, justified, and non-distracting.
- Reduced-motion alternatives preserve emphasis and sequencing.
- Animation does not delay operation or obscure the committed state.

### B9. Copy, iconography, and product voice — 2 points

Evaluate whether language and symbols belong to one product.

Check:

- Labels describe user intent and consequences rather than internal phases, AI plumbing, or data models.
- Terminology, capitalization, punctuation, pluralization, and tone are consistent.
- Icons come from the approved family and include labels where meaning is not universal.
- Emoji do not substitute for status, navigation, or branded iconography unless explicitly part of the direction.
- Empty/error/success copy gives a useful next step and avoids generic filler.

### B10. Edge-state completeness and verification — 2 points

Evaluate whether adherence survives real data and non-happy paths.

Check:

- Loading, empty, partial, error, offline, reconnecting, permission-denied, disabled, busy, success, and terminal states were reviewed where applicable.
- Representative viewports and stress fixtures have automated or recorded visual coverage.
- Overflow, contrast, focus, undefined-token, and interaction regressions are checked.
- Intentional exceptions are documented with an owner or removal condition.

## Grades

Apply gate caps first, then use the resulting score.

| Score | Grade | Interpretation |
|---:|:---:|---|
| 95–100 | A+ | Reference implementation; strengthens the system |
| 90–94 | A | Excellent; only isolated, low-risk gaps |
| 85–89 | A− | Strong and shippable; small cleanup remains |
| 80–84 | B+ | Good; coherent with visible but non-blocking drift |
| 75–79 | B | Serviceable; several system/adherence gaps should be planned |
| 70–74 | B− | Marginal; inconsistency or state debt is noticeable |
| 65–69 | C+ | Weak; remediation required before calling it system-compliant |
| 60–64 | C | Significant drift; system benefits are not reliably reaching users |
| 50–59 | D | Fails a core quality or operability expectation |
| 0–49 | F | Undesigned, inaccessible, materially broken, or misleading |

The combined grade must never be reported without the two subscores and gate status. For example:

```text
System quality: 31/40
Implementation adherence: 34/60
Arithmetic total: 65/100
Gate status: G1 failed → capped at 59
Final: 59/100 (D)
```

## Party-game entertainment TV profile

Use this profile when applying the rubric to Party Games. It translates the general criteria into visual layout and flow questions; it does not add a new framework or change the 100-point denominator.

### Reference benchmarks

No single game is the model. Use a composite benchmark and borrow each title’s strongest pattern.

| Benchmark | Use it to study | Do not copy |
|---|---|---|
| **Cranium Kabookii** | Closest reference for Activity Party: four strongly identified challenge categories, team handoff, timed creative tasks, a single shared controller, and decoder glasses that reveal private information to one player. Contemporary reviews describe clear presentation, category characters, clocked drawing/music/acting/quiz tasks, and the special hidden-message glasses. ([GameSpot](https://www.gamespot.com/articles/ubisoft-cracks-open-cranium-kabookii/1100-6177280/), [Cubed3](https://www.cubed3.com/games/reviews/wii/cranium-kabookii), [WorthPlaying](https://worthplaying.com/article/2008/3/18/reviews/49681-wii-review-cranium-kabookii/)) | Wii-specific pointer interaction, the literal Cranium characters/brand, or its merely adequate/low-ceremony presentation |
| **Wii Party / Wii Party U** | Friendly setup, player-count-aware mode selection, low-reading-load instruction screens, avatar-anchored turns, living-room activity, and a consistent shell across many kinds of games. Wii Party explicitly moves play between TV and room; Wii Party U separates TV Party, House Party, and GamePad Party and can suggest a game from group needs. ([Wii Party](https://www.nintendo.com/en-gb/Games/Wii/Wii-Party-283938.html), [Wii Party U manual](https://www.nintendo.com/eu/media/downloads/games_8/emanuals/wii_u_6/wii_party_u/ElectronicManual_WiiU_WiiPartyU_EN.pdf)) | A Mii/avatar platform, board-game metagame, or Nintendo’s soft visual skin |
| **Jackbox Party Packs** | Best reference for “TV is the stage; phone is the private controller.” Study friction-light room joining, public prompts and reveals, private answer entry, audience-readable timing, and individual games with strong show identities inside a common session model. Jackbox’s official flow is launch on the shared screen, then join from a browser using the room code. ([How to Play](https://www.jackboxgames.com/how-to-play), [support guide](https://support.jackboxgames.com/hc/en-us/articles/15794771245975-How-do-I-get-started-playing-Jackbox-Games)) | Phone dependence for actions that are better communal, adult/text-heavy tone, or a lobby code permanently consuming stage space |
| **Buzz! Quiz TV / The BIG Quiz** | Pure game-show staging: host, studio set, podium/contestant placement, physical buzzer ownership, round transitions, lock feedback, score tension, and winner ceremony. Reviews describe its deliberate TV-show presentation and dedicated buzzer controllers. ([GameSpot: The BIG Quiz](https://www.gamespot.com/reviews/buzz-the-big-quiz-review/1900-6148408/), [GameSpot: Quiz TV](https://www.gamespot.com/reviews/buzz-quiz-tv-review/1900-6193494/)) | Dated character stereotypes, slow unskippable host banter, or decorative 3D set pieces that reduce clue legibility |
| **Nintendo Land** | Public/private information asymmetry and role clarity. Nintendo explicitly framed it around the GamePad showing a different view from the TV. This is the right benchmark for verifier, performer-secret, and hidden-answer flows. ([Nintendo](https://www.nintendo.com/en-gb/News/2012/Nintendo-s-Wii-U-ushers-in-a-new-age-of-video-games-with-integrated-second-screen-experience-253334.html)) | Hardware-specific GamePad assumptions or franchise/theme-park scope |
| **Mario Party Jamboree / Jamboree TV** | Minigame introduction cards, concise control teaching, player-color continuity, spectacle around small events, ranking, and completion ceremony. Jamboree TV explicitly presents players as contestants in a hosted show. ([Nintendo](https://www.nintendo.com/us/store/products/nintendo-switch-2-super-mario-party-jamboree-nintendo-switch-2-edition-plus-jamboree-tv-switch-2/)) | The board/metagame, character platform, content volume, or camera features |
| **Everybody 1-2-Switch / AirConsole** | Secondary references for large-group phone joining, team formation, rejoin/failure handling, and separating a shared “big screen” from personal controllers. Nintendo supports team games with smart devices; AirConsole explicitly defines Big Screen and Controller roles. ([Nintendo](https://www.nintendo.com/us/store/products/everybody-1-2-switch-switch/), [AirConsole](https://www.airconsole.com/info)) | Their catalog/store architecture or inconsistent game-level art direction |

### Recommended benchmark hierarchy for Party Games

1. **Cranium Kabookii** for Activity/Charades mechanics and secret handling.
2. **Buzz!** for the shared TV’s game-show layout, buzzer feedback, and ceremony.
3. **Jackbox** for TV/phone responsibility and per-game identity.
4. **Wii Party** for setup, accessibility, handoff, and living-room flow.
5. **Nintendo Land** for asymmetric information.
6. **Mario Party Jamboree** for instruction, transition, and results polish.

Kahoot is useful for high-scale joining and answer-state clarity, but it is a classroom/event-tool benchmark rather than the primary art-direction benchmark for this app.

### Visual layout and flow criteria

Score these through the existing A and B criteria.

#### 1. One-glance stage hierarchy

- From ten feet away, can a new viewer identify the game, current task, active team/player, time remaining, score, and next action within two seconds?
- Is there one dominant game fact per state rather than several equally loud headings?
- Do clue/prompt text and critical numbers receive the largest readable area?
- Is persistent chrome quieter than the current play state?

#### 2. Stable stage zones

- Does every game compose within known regions for round/show identity, main play, timer/status, score, and optional companion entry?
- Are QR codes, scoreboards, timers, and effects allocated space rather than absolutely overlaid on unknown content?
- Can a game use the full stage when a region is not needed?
- Does the layout fill each supported TV frame intentionally without black strips or body scrolling?

The goal is a small shared stage grammar, not one identical layout for every game.

#### 3. Setup and instruction economy

- Does setup ask only what this game needs?
- Can the picker communicate player count, duration, interaction type, and required equipment without opening the game?
- Before a timed action, is there a short instruction/rehearsal state that shows the goal, who acts, and the control?
- Can experienced players skip repeated explanation?

#### 4. Actor, turn, and handoff clarity

- Is the active performer/team unmistakable through name, avatar/color, position, and copy—not color alone?
- Does the outgoing state explicitly hand the room to the next actor?
- Does controller/buzzer ownership remain understandable after each handoff?
- Can late joiners understand whose turn it is by looking only at the TV?

#### 5. Public versus private information

- Is information intentionally assigned to audience TV, host phone, performer device/filter, or verifier device?
- Are secrets actually concealed from guessers?
- If a physical decoder is required, does the screen tell the room who uses it and when?
- Does the TV avoid duplicating private phone content merely because it is convenient to render?

#### 6. Pacing and state choreography

- Is the rhythm explicit: gather → explain → ready → reveal → play → judge → score → handoff → finish?
- Does every command produce immediate pending/accepted/rejected feedback?
- Are transition durations short enough for repeat play but long enough for a room to register what changed?
- Can the host recover, back out, retry, or skip without breaking the show?

#### 7. Reveal, feedback, and ceremony

- Do buzz, timer expiry, correct/incorrect/pass, score changes, round changes, and winners have distinct audiovisual signatures?
- Does motion explain causality rather than provide generic pulsing?
- Are winner/tie results staged as an entertainment payoff rather than a settings-page list?
- Do mute and reduced-motion modes preserve the same meaning through static emphasis and copy?

#### 8. Show identity within a shared family

- Can each game have its own scenic palette, display type, texture, and reveal style?
- Do all games retain consistent control behavior, focus, scoreboard meaning, timer behavior, safe areas, and state vocabulary?
- Are show-specific values declared together as tokens/variables rather than scattered literals?
- Does the shell feel like the same game-show network without flattening every show into the same skin?

A practical implementation can be small: shared `Stage`, `Scoreboard`, `Timer`, `InstructionCard`, `OutcomeReveal`, and `Results` patterns plus show-scoped custom properties. Promote only patterns that are already repeated.

### Default visual direction: broadcast playhouse

Party Games should feel like a family game-show network: theatrical enough to make ordinary actions feel consequential, but controlled enough that a room can read the state instantly. The default network layer uses a dark studio stage, warm light copy, brass show chrome, tactile controls, and brief moments of marquee energy. Individual shows may replace scenic accents, textures, display treatments, and reveal motifs without changing the interaction grammar.

This is a construction rule, not a requirement to make every screen visually identical.

| Element | Default rule | Allowed show variation | Failure signal |
|---|---|---|---|
| **Geometry** | Stable rectangular composition with a small radius scale: tight controls, medium cards, larger scenic frames. Use one signature clipped or offset corner on title plates and hero frames. | A show may alter the scenic silhouette while preserving content bounds, focus shape, and alignment. | Every object has a different radius, arbitrary blob shapes, or a tilted layout that makes the stage feel unstable. |
| **Buttons** | Controls remain level and aligned. Use a shallow top highlight, darker bottom edge, and 2–4 px offset/extrusion so they read as pressable from across the room. On press, move down about 2 px and collapse the extrusion. | Primary/buzzer actions may be larger, rounder, or use a show accent. Choice cards may alternate a very small visual tilt, no more than about 0.75 degrees, when it does not affect wrapping or focus. | Rotating every button, pill-shaped everything, mismatched silhouettes, excessive gloss, or motion used as the only pressed cue. |
| **Asymmetry** | Put asymmetry in decorative layers: an offset shadow plate, clipped title tab, corner badge, angled rule, or deliberately unbalanced scenic framing. Keep text baselines, grids, controls, and score columns geometrically stable. | Activity/Charades may feel looser and handmade; Jeopardy may remain rigid and architectural. | Random per-item rotations or offsets that look generated rather than art-directed. |
| **Borders** | Use a 1 px low-contrast keyline for ordinary surfaces, a 2 px accent keyline for selected/reveal states, and a separate 3 px high-contrast focus ring with offset. Use team color as a stripe or badge, not the entire border vocabulary. | A show may substitute bulbs, dashes, ticket perforation, or a double-rule on scenic frames only. | Heavy borders around every region, focus styling confused with selection, or team/status colors competing on one edge. |
| **Depth and emboss** | Use shallow physical depth on actionable controls and raised score/name plates. Panels normally remain flat or softly inset. Depth has one light direction: lighter top/left, darker bottom/right. | A buzzer or final answer control may use stronger physical depth for ceremony. | Deep bevels, chrome gloss, inconsistent light direction, or shadows used to hide weak hierarchy. |
| **Gradients** | Allow one restrained vertical face gradient on tactile controls and one broad radial stage glow behind the current focal area. Keep gradients within one hue family and use them to describe light or depth. | Show backgrounds may add a controlled two-color scenic wash if text still sits on a stable contrast surface. | Generic purple/blue gradient soup, a gradient on every card, or unrelated gradient directions. |
| **Color** | Network chrome defaults to ink/navy stage, warm ivory text, and brass accent. Reserve danger red for destructive/error/expiry meaning. Treat team colors as data and pair them with names, position, or icons. | Each show gets one dominant scenic hue and one supporting accent; those colors may tint the stage glow, title plate, category art, and reveal effects. | More than two equally loud scenic accents, team colors reused as system status, or saturated backgrounds behind long text. |
| **Typography** | Keep three roles: condensed display for short show titles, category labels, scores, and big numerals; a highly readable text face for prompts/clues; neutral UI sans for controls and phone utilities. Use no more than two roles in one local composition. | A show may replace the display face if its metrics and legibility meet the same contract. Body/prompt and utility roles remain stable. | Display fonts in paragraphs, long all-caps instructions, four unrelated families, fake outlined type everywhere, or type that supplies personality at the cost of reading speed. |
| **Texture and ornament** | Use one low-opacity scenic texture at a time—light grid, halftone, rays, curtains, or studio panels—and keep the prompt surface quiet. Ornament belongs at the perimeter. | Each show may own one recurring motif and an outcome effect. | Confetti, sparkles, stickers, glows, grain, and glass effects stacked together by default. |

#### Motion grammar

Motion should communicate a state change, then get out of the way.

| Event | Recommended treatment |
|---|---|
| Button press | 70–100 ms downward compression; restore on release |
| Focus/navigation | Immediate outline; optional 100–140 ms scale or luminance settle, never a looping pulse |
| Screen/state enter | 180–260 ms fade with 8–16 px directional travel tied to the flow |
| Screen/state exit | 120–180 ms, faster than entry |
| Prompt/reveal | 300–500 ms staged reveal; text becomes readable as soon as it settles |
| Score change | Number tick/slide plus a brief team-color flash, 300–600 ms total |
| Buzz lock | Immediate freeze/flash and clear owner label; any impact animation finishes within 400 ms |
| Timer warning | One state change at the warning threshold plus persistent static urgency; do not pulse continuously for the final ten seconds |
| Winner/final result | A 1–2 second celebratory build followed by a stable, readable result screen |

Blinking bulbs or crawling/chasing borders are a **ceremony effect**, not ambient decoration. Permit them only for short-lived `ready`, buzz-lock, reveal, or winner moments; stop after two cycles or roughly 1.5 seconds. Never blink prompt text, scores, navigation, or the whole viewport. Reduced-motion mode replaces travel/chase effects with an immediate static keyline, luminance change, label, or icon so meaning survives.

#### Shared versus show-owned decisions

The network layer owns:

- Control silhouette, pressed/focus/disabled behavior, touch targets, and depth direction.
- Stage safe areas, spacing rhythm, readable prompt surfaces, scoreboard semantics, and timer states.
- Typography roles, motion durations, reduced-motion substitutions, status colors, and contrast rules.
- The order and meaning of setup, instruction, ready, play, judge, score, handoff, and result states.

Each show owns:

- One dominant scenic hue, one supporting accent, and one perimeter texture or motif.
- Its title treatment and optional display face.
- Category/round art, scenic framing, transition sting, and outcome reveal motif.
- Carefully bounded asymmetry appropriate to that show.

For the current implementation, the existing navy/ivory/brass palette and `Anton`/`Bitter`/system-UI role split are a credible network starting point. The main problem is not that those choices are wrong; it is that their construction rules are not yet explicit enough to prevent new screens from improvising unrelated buttons, borders, gradients, and motion.

## Required evidence set

A full audit should include:

1. **System inventory:** token sources, themes, fonts/icons, primitives, component APIs, documentation, and enforcement tests.
2. **Screen/state inventory:** every route/view plus loading, empty, error, offline, busy, disabled, success, and terminal variants.
3. **Viewport matrix:** all declared surfaces; for DaylightStation this commonly includes a 960×540 TV frame and a representative phone viewport, plus any product-specific targets.
4. **Content stress matrix:** longest realistic labels/names, maximum item/team counts, missing/failed media, large numbers, localization expansion, and 200% text.
5. **Input matrix:** pointer, keyboard, touch, gamepad/remote, and companion input where supported.
6. **Preference matrix:** reduced motion, high contrast where supported, and zoom/text scaling.
7. **Source checks:** raw/undefined token use, duplicate primitives, browser-default controls, inline stable presentation, unguarded animation, and overflow-prone layout rules.
8. **Measured evidence:** screenshots, bounding boxes, scroll/client dimensions, contrast results, focus order, console errors, and observed no-op or stale states.

When a criterion lacks enough evidence, mark it **Not verified**, not 4. An unverified criterion receives 0 provisionally or is removed from the denominator only when the audit explicitly explains why it is genuinely inapplicable. Never remove a criterion merely because the implementation omitted it.

## Audit worksheet

| ID | Criterion | Weight | Rating 0–4 | Points | Evidence | Required remediation |
|---|---|---:|---:|---:|---|---|
| A1 | Product direction and principles | 6 |  |  |  |  |
| A2 | Semantic token architecture | 8 |  |  |  |  |
| A3 | Foundation scales and composition | 5 |  |  |  |  |
| A4 | Primitive/component coverage | 8 |  |  |  |  |
| A5 | State/accessibility contract | 8 |  |  |  |  |
| A6 | Documentation and governance | 5 |  |  |  |  |
|  | **System quality subtotal** | **40** |  |  |  |  |
| B1 | Token adoption | 9 |  |  |  |  |
| B2 | Primitive reuse | 9 |  |  |  |  |
| B3 | Layout/responsive containment | 8 |  |  |  |  |
| B4 | Typography/hierarchy | 6 |  |  |  |  |
| B5 | Color/contrast/state fidelity | 6 |  |  |  |  |
| B6 | Interaction/input parity | 7 |  |  |  |  |
| B7 | Accessibility semantics | 7 |  |  |  |  |
| B8 | Motion/transitions/feedback | 4 |  |  |  |  |
| B9 | Copy/iconography/voice | 2 |  |  |  |  |
| B10 | Edge states/verification | 2 |  |  |  |  |
|  | **Adherence subtotal** | **60** |  |  |  |  |
|  | **Arithmetic total** | **100** |  |  |  |  |

### Gate record

| Gate | Pass/fail | Evidence | Cap applied |
|---|---|---|---:|
| G1. Core operability |  |  |  |
| G2. Accessible operation |  |  |  |
| G3. State completeness |  |  |  |
| G4. Responsive containment |  |  |  |
| G5. Truthful feedback |  |  |  |

### Final report

```text
System quality: __ / 40
Implementation adherence: __ / 60
Arithmetic total: __ / 100
Gate status: __
Final capped score: __ / 100 (__)
Confidence: high / medium / low
Top strengths: __
Top violations: __
Required before release: __
```

## AI-slop smell check

These are diagnostic signals, not automatic point deductions. Score their actual effect under direction, token adoption, hierarchy, motion, and product voice.

- Generic dark gradient, one neon accent, giant centered title, and a vertical stack of pills without a product-specific composition.
- Multiple near-identical grays/accents that bypass existing tokens.
- Unrelated visual themes across sibling screens.
- Browser-default controls mixed into styled surfaces.
- Excessive all-caps, glow, glass, gradient, emoji, or pulse effects without semantic purpose.
- Raw machine labels, AI/system terminology, placeholder copy, or repetitive headings exposed to users.
- One-off micro-animations with no shared motion language.
- Large dead areas caused by centering every state rather than composing around the task.
- Dense one-line styles or copied component CSS that suggest generation without system integration.
- Superficially polished happy paths paired with absent loading, failure, overflow, focus, or terminal states.

The remedy is not “make it less AI-looking.” The remedy is to make every choice traceable to product direction, semantic tokens, shared behavior, real content constraints, and verified user states.
