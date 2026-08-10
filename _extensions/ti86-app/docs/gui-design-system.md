# SchoolCalc calculator design system

SchoolCalc is a portable learning product with device-specific shells. This
document defines the TI-86 realization while keeping pedagogical concepts and
content independent of calculator family.

> **Adaptive Study v1 release profile:** The foundations, framebuffer,
> typography, shell regions, input boundary, choice controls, result/QR views,
> sync states, and durability rules in this document are retained
> infrastructure. The canonical v1 learner flow and exact card rails are in
> [`schoolcalc-v1-requirements.md`](./schoolcalc-v1-requirements.md).
> Catalog, Home, lesson, reader, profile, progress, tutor, and native-handoff
> templates below are retained design research and are inactive in the default
> v1 installation.

## Adaptive Study v1 profile

Every launch begins on an `ENTER CODE` template. The only normal route is code
entry/resolution, adaptive StudyCard, study summary, A-E ChoiceQuestion, Result,
and QR; Sync is entered only to resolve a new code or deliver queued results.
Enter Code exposes no Resume shortcut: F1 appears as `OPEN` only after digit
six, F2-F4 remain blank, and F5 is the far-right `EXIT` action.

The adaptive card rail is fixed and sparse:

| Surface | F1 | F2 | F3 | F4 | F5 |
| --- | --- | --- | --- | --- | --- |
| front | `FLIP` | blank | blank | blank | blank |
| back | `FLIP` | blank | `AGAIN` | `HARD` | `KNOW` |

Empty means no pixels and no key behavior. In particular, the general v0
`F2 BACK` exception does not apply to adaptive cards. `EXIT` is the power-safe
pause path. After study the summary exposes `F5 QUIZ`; after the result is
durably queued, Result exposes QR and return-to-code actions. Re-entering the
completed local code reopens Result.

The study summary is four aligned label/value rows—`KNOWN`, `HARD`, `AGAIN`,
and `UNRESOLVED`—and every row includes its numeric count. Quiz screens replace
the study title with `QUIZ: <subject>` from the immutable artifact while keeping
the current item position at the right edge.

The adaptive card body is always bounded by a one-pixel frame at x=1..126 and
y=9..54. Text-only pages are centered by measured line width and total block
height. A graphic page divides the interior into an upper vector canvas and a
lower two-line caption band; the border, header, and rail never move. Vector
art is authored in normalized coordinates and compiled to bounded monochrome
line/label commands, so geometry diagrams remain editable content rather than
full-screen bitmap payloads.

The v1 QR template renders a Version-5/M symbol whose actual encoded payload is
at most 69 bytes. It does not treat optical display as acknowledgement. Plain
recovery text is mandatory for unknown, closed, unauthorized, incompatible,
memory-blocked, and interrupted code resolutions.

Before relay verification, Sync uses a bordered four-position moving `LINK`
meter. It is explicitly indeterminate: motion means the calculator is still
polling, not that content bytes have arrived. A verified handshake replaces it
with the existing direction/phase view and determinate item bar. Terminal
headers use `DONE` for success and `STOP` for blocked, cancelled, disconnected,
or protocol-failure states, with safe-unplug guidance in the body.

## Taxonomy

```text
SchoolCalc device experience
├── 1. Foundations
│   ├── framebuffer and color
│   ├── memory and executable budgets
│   ├── typography
│   └── iconography and drawing primitives
├── 2. Physical interaction
│   ├── arrows, ENTER, EXIT, numeric/ALPHA keys
│   └── contextual F1–F5 softkeys
├── 3. Shell layout
│   ├── sticky header
│   ├── one-pixel breathing margin
│   ├── scrollable body and rail
│   └── F1–F5 action bar
├── 4. UI components
│   ├── navigation and selection
│   ├── overview, focus, and stable inspection
│   ├── learner identity and Guest
│   ├── learning content
│   ├── response input
│   └── feedback, status, and confirmation
├── 5. View templates
│   ├── browse, lesson, document, and card
│   ├── overview/detail, question, input, result, and sync
│   └── modal and QR
├── 6. State model
│   ├── focus and scroll
│   ├── offline queue and acknowledgements
│   └── durable continuation state
├── 7. QR channel
│   ├── opaque School action tokens
│   ├── result/progress records
│   └── self-reported output receipts
├── 8. Native-tool bridge
│   ├── graph, home calculator, table, solver, and matrices
│   └── snapshot, suspend, OS handoff, and resume
└── 9. Verification assets
    ├── glyph and icon maps
    ├── 128×64 golden screens
    └── PNG, QR, protocol, and hardware tests
```

The levels have different jobs:

- **Foundations** are physical constraints and reusable visual tokens.
- **Physical interaction** assigns behavior to keys already on the calculator.
- **Shell layout** defines the stable regions of every SchoolCalc screen.
- **UI components** are reusable controls and content presenters.
- **View templates** compose components around a learner task.
- **State** makes views resumable, idempotent, and safe while offline.
- **QR** turns the LCD into an outbound School scanner channel.
- **Native-tool bridge** safely yields to built-in calculator environments.
- **Verification assets** keep the implementation honest at pixel and protocol level.

Subject names never belong in the component taxonomy. A physics formula, finance
definition, and chemistry fact use the same content components. Specialized
behavior is selected by a capability such as `graph@1`, not by branching on
course or subject.

## 1. Foundations

### Display

| Token | Contract |
| --- | --- |
| Framebuffer | Exactly 128×64 physical pixels |
| Source cell | One YAML `.` or `█` equals one LCD pixel |
| Color | One bit; no semantic grayscale or fragile dithering |
| Minimum mark | One physical pixel |
| LCD buffer | 1,024 bytes |
| Preview | May magnify with nearest-neighbor scaling; never crops the canvas |

### Resource budget

A factory-reset TI-86 reports 98,224 bytes of user RAM. The table preserves
reviewed per-component ceilings; rows for Catalog, delivery requests, native,
profile, and tutor runtimes are inactive v0/future budgets and do not imply
inclusion in the Adaptive Study v1 package:

| Allocation | Target |
| --- | ---: |
| Native `Asm(` shell, including fonts/icons | at most 9 KB; below the 9,400-byte physical window |
| Standard reviewed learning runtime | 6 KB target; 8 KB ceiling |
| Dynamic result-QR runtime | 4 KB target; 6 KB ceiling |
| Generic Catalog runtime | 6 KB target; 8 KB ceiling |
| Delivery-request runtime | 6 KB target; 8 KB ceiling |
| Result/progress queue runtime | 4 KB target; 8 KB ceiling |
| Cooperative foreground-sync runtime | 6 KB target; 8 KB ceiling |
| Read-only native-plan guard runtime | 6 KB target; 8 KB ceiling |
| Learner-profile and compact-progress runtime | 6 KB target; 8 KB ceiling |
| Realtime remediation runtime | 6 KB target; 8 KB ceiling |
| Catalog index and durable device/session state | 4–6 KB |
| Offline result/progress queue | 4–6 KB |
| Offline delivery-request queue | 0.5–2 KB |
| Realtime interaction request/response | 0.25/1 KB targets; 0.5/2 KB ceilings |
| Install/replace scratch space and free safety margin | 10–12 KB |
| Downloadable lesson content with standard client reserved | about 5–25 KiB |

The ordinary executable begins at `$D748`; the live LCD begins at `$FC00`.
Keeping each executable within its reviewed window leaves clear working room
before the display. The retained v0 client was a build-pinned ten-program
release (`SCHLCALC`, `SCLEARN`, `SCQR`, `SCCAT`, `SCREQ`, `SCQUEUE`, `SCSYNC`,
`SCNATIVE`, `SCPROF`, and `SCTUTOR`). The Adaptive Study v1 default manifest is
the smaller shell/learn/queue/QR/sync boundary in
[`schoolcalc-packaging.md`](./schoolcalc-packaging.md). Each TI variable is also
charged conservative storage overhead. A content
artifact targets 8 KB and has a 12 KB hard ceiling so an update can be installed
without first destroying the usable old copy. Optional reviewed runtimes reduce
lesson capacity and are admitted from actual reported free RAM, never from an
unaccounted bucket. Native handoff's transient `SCN1` snapshot is capped at
4,096 bytes inside the 10,240-byte reserve; after its 32-byte variable overhead,
at least 6,112 bytes remain. Low memory is reported before settings change.

### Typography

SchoolCalc uses a custom bitmap family from
[`type.yml`](../gui/type.yml):

| Face | Glyph and advance | Use |
| --- | --- | --- |
| `code-7x8` | 7×8, digit-only linked subset | Six-digit Enter Code value exclusively |
| `compact-3x5` | 3×5 on 4×6 | Uppercase header chrome, dense lists, badges, F-key labels |
| `reader-4x6` | Up to 4×6, proportional 2–5 px advance on 7 px lines | Mixed-case notes, cards, explanations, and prompts |
| `display-5x7` | 5×7 on 6×8 | Short answers, scores, and critical emphasis |

Case is semantic typography, not a hardware limitation. Compact chrome is
uppercase for recognition at three pixels wide. Reading content uses normal
mixed case because lowercase shapes need four pixels to remain distinguishable.

Content strings remain text. At runtime the Z80 renderer performs glyph lookup,
proportional measurement, wrapping, truncation, and framebuffer composition.
The reader face gives narrow glyphs such as `i`, `l`, and punctuation 2–3 pixel
advances while wide glyphs such as `m` keep the full 5 pixels. Its `g`, `j`,
`p`, `q`, `y`, comma, and semicolon may occupy the otherwise blank seventh
scanline as a descender; other lines retain that pixel as breathing room.

Full-screen bitmaps are golden references, not the production storage format.
Generated general font tables use one byte per visible glyph row (5, 6, or 7 bytes per
glyph), not a padded eight-byte cell. The unused low three bits of the first
row carry glyph advance; the reader's unused low nibble in its sixth row packs
the optional descender. Both features therefore add no per-glyph storage.
The code face is emitted separately as eleven exact eight-byte bitmaps (dash
and digits 0-9), so unused ASCII glyphs cannot consume the shell budget.

### Context headers

One header line cannot carry a literal Course → Unit → Lesson path reliably.
Instead, every non-root Catalog list uses the immediately containing content
title as its breadcrumb: the Course list is headed by its Subject, the Unit
list by its Course, the Lesson list by its Unit, and the Module list by its
Lesson. The root keeps `SUBJECTS` with the learner name. Generic words such as
`MODULES` and `QUIZ` describe the interaction only; they must not be the sole
answer to “what am I studying?”

An inline multiple-choice prompt owns exactly three compact rows at y=11,17,23.
It is followed by four blank pixel rows, then a four-row choice region at
y=32,38,44,50. Each 3×5 answer row retains its one-pixel vertical gap. A
five-choice prompt may use two answer columns only when every label fits its
own half-width without clipping. Otherwise the runner uses its explicit
multi-page fallback rather than collapsing the spacing or making an answer
ambiguous.

### Iconography

Icons are authored as 7×7 one-bit glyphs in
[`icons.yml`](../gui/icons.yml). The families are:

- contextual actions: info, install, search, sync, queue, mark, flip, QR;
- decisions: check and close;
- direct choices: A, B, C, D, E;
- instructional hardware symbols: arrows, back, home, and exit.

A hardware symbol is not automatically an on-screen control. Arrow and ENTER
glyphs appear in help or a one-time instruction only. The v1 Enter Code rail
deliberately labels F5 `EXIT`; other persistent rails do not duplicate hardware
buttons already under the learner's fingers.

## 2. Physical interaction

Hardware comes first:

| Key | Stable meaning |
| --- | --- |
| Up/Down | Move focus or scroll the current body |
| Left/Right | Parent/child, page, or previous/next card when declared |
| ENTER | Open, commit, or continue |
| EXIT | Return one SchoolCalc level; Home remains open; `2nd` + EXIT quits to TI-OS |
| 2nd + Up/Down | Adjust LCD contrast one saturated step; consume the chord without moving focus or scrolling |
| DEL | Delete one input unit |
| CLEAR | Return one SchoolCalc level (the same Back/cancel behavior as EXIT) |
| Numeric/ALPHA | Enter the corresponding response text |
| F1–F5 | Only the contextual action shown directly above that key |

F1–F5 are valuable precisely because they are contextual. They provide A–E
answers (or the answer text itself when it safely fits), FLIP, MARK, INFO, GET,
FIND, QR, CABLE, YES, and NO. Catalog and reader
views make one deliberate exception: F2 is visibly labeled `BACK`, alongside
the physical EXIT/CLEAR/LEFT shortcut, so hierarchy navigation never depends on
a memorized key. Reader views also reserve F1 for `TOP` (or `QR` when declared),
F4 for `PGUP`, and F5 for `NEXT`; F5 changes to `END` exactly at the final
block. The Subject root shows F5 `OFF` when no relay is detected, while deeper
Catalog lists use the same `NEXT`/`END` cue and page action instead of an
irrelevant transport affordance.

Quiz question and answer form one interaction. A normal compact question
renders up to three visible prompt rows, a deliberate gap, then its `A)`–`D)`
choice rows directly beneath it, with F1–F4 mapped to the same letters in the
rail. A fifth short answer may share a two-column row; typing a number is not a
hidden alternate response path. Only a genuinely tall prompt uses F5 `MORE`
and then `ANS` at its final page. Its answer view reserves the bottom body line
for `LEFT: Q`, returning to the final prompt page without discarding the answer
draft.

## 3. Shell layout

```text
y=00..07  inverted sticky header
y=08      blank bottom margin under header
y=09..54  scrollable body (46 px)
y=55      separator rule
y=56..63  contextual F1–F5 action bar
             overflow rail uses x=125..127 in the body only
```

### Sticky header

The title is left aligned at x=1. Compact context such as `3/20`, `2/5`, or
`Q2` is right aligned and ends at x=124. It never scrolls. If the two collide,
preserve the context and truncate the title with `...`.

The blank y=8 row is mandatory. It visually separates the dark header from the
first content line even though it costs one compact body row.

### Scroll body and rail

Compact lists fit seven rows. Mixed-case reading views fit six 7px lines.
A view chooses item, line, or page scrolling and never changes that model while
the view is active.

Wrapping is decided from measured pixel width, never raw character count. A
component supplies explicit left/right/bottom bounds; the renderer word-wraps,
hard-wraps an overlong token, and reports vertical overflow. Confirmation
goldens additionally fail lint if any content escapes their frame.

The rail appears only on overflow. Its track is x=127 from y=9 through y=54,
with a proportional thumb at x=125..127 and a six-pixel minimum. A header value
such as `3/20` describes the current card/question; the rail describes position
inside the current body.

### Softkey bar

The physical slots are fixed:

| Key | Pixel span |
| --- | ---: |
| F1 | x=0..25 |
| F2 | x=26..50 |
| F3 | x=51..76 |
| F4 | x=77..101 |
| F5 | x=102..127 |

An assigned slot is inverted. It may contain a 7×7 icon, a compact label, or
both. Empty slots remain empty; actions never shift between keys merely to fill
space. The result-QR output template is the narrow exception: it uses sparse
black `MARK` and `LATER` labels in the F1/F5 positions so its 45×45 quiet-zone
footprint remains optically blank above the rail.

## 4. UI components

### Navigation

- **BrowseList** — unboxed, seven one-line rows.
- **ListItem** — focus chevron, optional availability marker, title, and only
  then an optional right-aligned value badge.
- **AvailabilityIndicator** — a 4×4 hollow circle for remote content, filled
  circle for installed content, and alternating filled/hollow phases while a
  download is active. The phase changes every 100 ticks of the 200 Hz system
  clock (500 ms); state is never communicated by blinking alone.
- **ScrollRail** — body overflow and position.
- **PositionLabel** — card/question/page position in the sticky header.
- **ContextAction** — an icon/label bound to one fixed F-key.
- **OverviewCanvas** — preserves the shape of a bounded set while details move
  to a separate inspector; cells contain identity/status marks, not paragraphs.
- **FocusCursor** — the single selected cell, visible independently of content
  state and never communicated by inversion alone.
- **SelectionInspector** — a stable, non-scrolling region whose label, metrics,
  and actions update as focus moves; its geometry never jumps between items.
- **SnapNavigation** — arrow movement between valid overview cells with no
  invisible intermediate pixel positions.
- **StatusMarker** — a compact secondary state such as installed, recorded,
  pending, correct, or needs attention; it never replaces the focus cursor.
- **AlternateListView** — an optional linear presentation of the same item IDs
  for accessibility, search, or cases where topology is not the learner's task.
- **Legend** — decodes marks that cannot be safely inferred. It may live in
  INFO when the 128×64 primary view cannot spare permanent pixels.
- **PositionMemory** — retains a stable item key when data is refreshed and at
  least the local focus index while a calculator view remains open.

The focused row uses `>` at x=0. Ordinary lists begin text at x=5; Catalog rows
place the availability marker at x=5 and text at x=13. Selection is never shown
by inversion alone. Ordinary rows have no boxes, and the right rail is not
reused for per-item state.

### Overview + focus + inspector grammar

Use this grammar when the learner benefits from seeing relationships or a
large set while inspecting one item: curriculum history, a timeline, map,
formula family, graph trace, matrix, concept map, or a long stateful deck. The
overview answers “where am I and what else is here?”; the inspector answers
“what is this?”; a details view answers “show me everything.” These are three
different zoom levels and must not be collapsed into tiny labelled boxes.

Do not replace an ordinary seven-row menu merely because an overview exists.
A short, ungrouped action list remains a `BrowseList`. For flashcards, the
overview belongs to the deck/session (coverage, confidence, pending cards),
while the actual prompt and answer still use the full `StudyCard` face. For a
long list, use overview/detail only when grouping, state, or topology makes the
set itself instructional; otherwise keep the list, search, and scroll rail.

My Progress applies the grammar to the evidence-backed
Catalog→Subject→Course→Unit→Lesson→Module spine. A calculator has one installed
Catalog, so its first visible browse panel is Subject (the Catalog wrapper is
never rendered). The TI-86 inspector occupies
y=9..32 and the two-row, twelve-cell overview occupies y=36..53. `#`, `S`,
`C`, `U`, `L`, and `M` mean Catalog, Subject, Course, Unit, Lesson, and Module;
`!` means some evidence is pending reconciliation. The selected cell is
inverted. The web surface uses the same stable node keys and also exposes the
alternate list view. Neither surface infers that an authored parent is
complete from descendant evidence alone.

### Learning content

- **ProseBlock** — mixed-case wrapped reader text.
- **DefinitionBlock** — term followed by its concise definition.
- **FormulaBlock** — expression with named variables.
- **WorkedExample** — prompt, steps, and result.
- **InfoDocument** — sticky header + scrolling blocks.
- **StudyCard** — prompt/answer faces, per-face scroll, flip/mark actions.
- **ToolInvitation** — explains and launches a declared native capability.
- **ScanAction** — label plus an opaque server-issued School action token.

Reader controls are stable across InfoDocument and WorkedExample: Up/Down move
one authored block, F1 returns to the first block unless a declared scan action
uses it for QR, F2 returns to the containing lesson, and F4/F5 move by four
blocks while clamping at the beginning/end.

### Response input

- **ChoiceGroup** — chevron selection plus direct F1–F5 A–E.
- **NumericField** — display-size value, caret/rule, exact unit metadata.
- **TextField** — reader face, ALPHA input, cursor, delete behavior.
- **ConfirmationDialog** — the only routine boxed surface; safe action first.
- **CommitAction** — ENTER unless the question explicitly requires a softkey.
- **IdentityPicker** — configured learners plus synthetic Guest; focus and the
  remembered claim are separate marks, with SELECT on F1 and GUEST on F5.

### Feedback and system

- **StatusRow** — compact label/value.
- **ProgressMeter** — determinate work only.
- **QueueIndicator** — unacknowledged offline records.
- **OutputReceipt** — a local, self-reported QR scan marker. It is never a
  transport acknowledgement or a server-delivery claim.
- **ResultSummary** — score facts and QR/sync options.
- **ErrorNotice** — plain recovery instruction, never only an error number.
- **IdentityStatus** — selected/Guest, session-locked, missing-identity, or
  invalid-roster status with an explicit recovery action.
- **ProgressSummary** — compact selected-learner aggregate facts plus the
  focused curriculum-history node's score/activity/completion inspector; Guest
  has no synthetic durable history.
- **FollowUpList** — prioritized generic continue/next/review/remediation
  labels with honest availability; a label is not interactive until its
  surface has a durable action path.
- **TutorTurn** — one bounded learner-visible explanation/prompt/choice page;
  F1–F5 map exactly to A–E and the scroll rail covers body, rationale, prompt,
  and choice-label pages without implying that the connection is durable.
- **TutorStatus** — processing, paused, retryable, unavailable, mastered, or
  exhausted status with retained-request and reconnection guidance.
- **SyncStatus** — sent, acknowledged, installed, and safe-to-unplug states.
- **TransportPresence** — `unknown_idle`, `activity`, or handshake-verified;
  never infers a connected cable merely because both open-collector lines are high.
- **TransportDirection** — learner-oriented `sending`, `receiving`, `server`,
  `validating`, or `idle` state with an explicit current item.
- **TransferSafety** — exactly one of `keep connected` or `safe to unplug`.
- **TransferProgress** — determinate bytes/items when known; otherwise a named
  phase without a fabricated percentage.
- **LocalTransition** — a destination header plus a short `.` → `..` → `...`
  pulse before a local path change repaints, including the post-selection
  handoff from learner picker to Subject root. It is not a transfer, has no
  percentage, and never accepts input mid-action.

## 5. View templates

| Template | Required components |
| --- | --- |
| Home | Header, BrowseList, queue/storage badges, shortcuts |
| Catalog | learner-scoped Header (subject left, active learner right), BrowseList, availability markers, rail, OPEN/BACK/USER/SYNC |
| Lesson | Header, module BrowseList, INFO/MARK |
| Info document | Header, margin, ProseBlocks, rail, optional MARK |
| Study card (v0 reference) | Info document + card position + FLIP/MARK |
| Adaptive study card (v1) | Header/card position, fixed border, centered text or vector-canvas/caption split, exact sparse FLIP/AGAIN/HARD/KNOW rail |
| Enter code (v1) | `ENTER CODE` header, exclusive `code-7x8` six-digit editor, resolution status, F1 `OPEN` only at six digits, blank F2-F4, far-right F5 `EXIT` |
| Choice question | Prompt, choices, A–E softkeys |
| Numeric/text response | Prompt, input component, unit/help actions |
| Result | ResultSummary, QueueIndicator, QR/SYNC |
| Identity picker | Header, IdentityPicker, BrowseList, rail, SELECT/GUEST |
| Identity notice | Header, IdentityStatus, optional ErrorNotice, OK |
| My Progress | Header, ProgressSummary, OverviewCanvas, FocusCursor, stable SelectionInspector, StatusMarker, PositionMemory, FollowUpList; arrows move focus, F5 opens the switcher, and hardware EXIT returns |
| Tutor turn | Header, TutorTurn, ChoiceGroup, connection evidence, rail, A–E softkeys |
| Tutor status | Header, TutorStatus, connection evidence, recovery copy, optional TRY |
| Sync | StatusRows, optional ProgressMeter |
| Confirmation | Cleared framed dialog over stable parent context |
| QR | Dedicated full 128×64 framebuffer; no SchoolCalc chrome |
| QR output | Version-5 result QR, blank quiet zone, separator, sparse F1 MARK/F5 LATER receipt rail |
| Native handoff | Persisting transition view, then OS-owned UI |
| Local transition | Destination header plus a brief local `.`/`..`/`...` acknowledgement before the next Catalog path repaints, including selection → Subject root; no softkeys or transport claim |
| Custom module | Capability-owned geometry inside OverviewCanvas + FocusCursor + stable SelectionInspector + SnapNavigation; optional list fallback/legend follows its reviewed interaction contract |

## 6. State model

Every view separates durable session state from disposable drawing state.

Durable state includes:

- selected stable learner key, its explicit-selection marker (so Guest is not
  confused with first boot), and an independent session-attribution snapshot;
- catalog/lesson/module address;
- focused item and scroll offset;
- focused overview item by stable key where the surface can retain it (the
  current TI-86 runtime retains its bounded index only while My Progress is
  open; a refreshed web tree retains the key);
- current card/question and card-face offset;
- draft answers and committed responses;
- monotonic device result sequence;
- queued/acknowledged record state;
- native-tool continuation and restoration snapshot.

An uploaded record is identified by `{deviceId, sequence}`. Scanning its QR and
later sending it through the cable is a duplicate of the same record, not a
second attempt. Queue entries are removed only after an accepted or duplicate
server acknowledgement.

### Transport awareness

The Sync interface must remove cable guesswork without claiming evidence the
hardware cannot provide. An idle TI link has both open-collector lines released,
which is also the state of an unplugged cable. Therefore `connected` is shown
only after a valid relay/session handshake; electrical edges may be labelled
`activity`, and an idle unverified port is labelled `waiting` or `unknown`.

| State | Calculator copy | Progress | Unplug contract |
| --- | --- | --- | --- |
| `unknown_idle` | `RELAY: WAITING` | none | safe |
| `negotiating` | `RELAY: VERIFYING` | phase only | keep connected |
| `calculator_to_relay` | `SENDING TO RELAY` | item and bytes | keep connected |
| `network` | `RELAY CONTACTING SERVER` | phase only | keep connected |
| `relay_to_calculator` | `RECEIVING FROM RELAY` | item and bytes | keep connected |
| `validating` | `VALIDATING LOCALLY` | commit phase | safe after `DSSYNC` is complete |
| `committed` | `SYNC COMPLETE` | final counts | safe |
| `blocked` / `error` | reason plus recovery action | stopped | safe |

The M5 relay mirrors these states through its LED and `/status` document. The
calculator-oriented labels reverse the relay direction deliberately: relay
`calculator_to_relay` is calculator `SENDING`, while relay
`relay_to_calculator` is calculator `RECEIVING`. A percent is rendered only
when both a nonzero total and current count are known.

Silent Link and foreground ownership are deliberately distinguished. In the
implemented Silent Link compatibility path, the relay can report live phases
while TI-OS owns the cable; the shell shows honest waiting and terminal state.
The implemented cooperative SCF1 foreground client provides live animation;
its calculator-originated HELLO is accepted by the relay's idle listener without
an external pre-arm.
The normative evidence, framing, timeout, and safety rules are in
[`transport-awareness.md`](./transport-awareness.md).

## 7. QR channel

QR presentation is a design-system component because payload, density, quiet
zone, framebuffer ownership, and recovery behavior must agree.

### School action QR

```text
sch:<16-character opaque token>
```

The server derives and atomically registers the device-bound token. The
calculator does not encode `print worksheet`, printable/media target IDs,
provider IDs, learner identity, or policy. Downloaded SchoolCalc lesson actions
are limited to server-resolved worksheet printing and media launch; current
server-side quota, approval, debounce, enablement, and token-version policy is
applied at scan time. Unknown, revoked, or stale tokens produce a physical
explanation receipt instead of a silent scan.

Profile: QR Version 1, EC-L, 21×21 modules at 2×, four-module quiet zone:
58×58 pixels centered in the complete framebuffer. A normal action page uses
the standard sticky-header/body layout and labels only F1 as `QR`. F1 opens the
full-frame presenter; F1, ENTER, EXIT, or LEFT returns without advancing or
mutating the lesson.

### Result/progress QR

```text
sch:r1:<BASE32 of exact SCR1 bytes>
```

`SCR1` is the compact record also sent over the cable. It contains device
identity, monotonic sequence, snapshotted learner key, immutable artifact key,
module/item positions, responses or progress, and the TI's locally computed
`{correct,total,percent}` score evidence for assessments. The backend resolves
the authoritative artifact and historical learner binding, recomputes the
score, and rejects a mismatch.

BASE32 keeps the large body in QR alphanumeric mode. The proven maximum-density
profile is Version 9/EC-M: 53 modules plus four-module quiet zones, or 61×61
pixels; the legacy fixture fits 238 ordered A–E responses. Production v0 caps
assessments at 48 choices and uses fixed Version 5/EC-M/mask 0 in `SCQR`: 37
modules and its quiet zone occupy 45×45 pixels. This covers up to 69 raw bytes;
the maximum runtime-generated `SCR1` is 67 bytes.

The `sch:` namespace always outranks a scanner's configured route, so the
kitchen scanner and every other household scanner can ingest these codes.
School scan dispatch must distinguish canonical opaque tokens from the reserved
`r1:` record form before invoking the corresponding use case.

The host generator is
[`generate-schoolcalc-qr.mjs`](../tools/generate-schoolcalc-qr.mjs), backed by
[`schoolcalc-qr.mjs`](../tools/lib/schoolcalc-qr.mjs). The calculator reference
and structural-asset generator is
[`ti86-result-qr-v5.mjs`](../tools/lib/ti86-result-qr-v5.mjs); the matching Z80
runtime is [`runtime-qr.asm`](../src/runtime-qr.asm). The runtime reads only the
newest validated queued record and never writes or acknowledges `DSQ`. Its
sparse F1 `MARK` action may set one ordinal in the calculator-private
`DSQOUT`/`SCO1` receipt map; F5 `LATER` leaves that ordinal pending for the
generic batch-output view. Neither action can remove a queue record.

## 8. Native-tool bridge

Native tools are a durable suspend/resume boundary:

```text
SchoolCalc
  → persist DSLOCAL
  → snapshot native variables
  → apply lesson configuration
  → yield to TI-86 OS tool
  → learner exits to OS
  → launch SchoolCalc from CUSTOM
  → restore native snapshot
  → resume exact SchoolCalc continuation
```

The initial capabilities are `calculator@1`, `graph@1`, `table@1`,
`solver@1`, `matrix@1`, `equation-editor@1`, and `native-program@1`. Content
names the capability and neutral configuration. Only the TI-86 adapter knows
ROM entry points, equation variable formats, TI-BASIC variable names, or menu
installation. Native program requests resolve through a reviewed allowlist;
content never supplies executable source.

For TI-86 artifacts, that neutral configuration compiles to a bounded plan of
finite operation/launch/resource codes plus reviewed equation and numeric data.
The runtime independently decodes the exact operation/launch pair, mutation
scope, ≤1,152-byte payload, 192-byte/16-level token grammar, canonical reals,
and shared program allowlist before the first write.
`SCN1` snapshots only the declared native resources before configuration; its
generation and capability must match `SCL1`. The runtime must not show a launch
action until the snapshot, continuation, configuration phase, and
restore-pending phase are durable. Recovery errors use the standard sticky
error/status panel and retain the queued result state.

The Z80 stack and executable RAM are never treated as continuation state.
Automatic OS hooks may be explored later, but are not part of v0 correctness.
The detailed contract is in
[`native-tool-handoff.md`](./native-tool-handoff.md).

## 9. Verification assets

| Asset | Purpose |
| --- | --- |
| [`design-system.yml`](../gui/design-system.yml) | Machine-readable regions, components, layouts, interaction rules, QR profile, and required templates |
| [`type.yml`](../gui/type.yml) | Reviewable custom glyph maps |
| [`icons.yml`](../gui/icons.yml) | Reviewable semantic icon maps |
| [`screens.yml`](../gui/screens.yml) | Complete 128×64 golden screens |
| [`generate-gui.mjs`](../tools/generate-gui.mjs) | Deterministic layout composition |
| [`lint-gui.mjs`](../tools/lint-gui.mjs) | Semantic component/template/interaction and exact-pixel layout gate |
| [`render-gui.mjs`](../tools/render-gui.mjs) | Lint-gated schema validation and PNG previews |
| [`generate-schoolcalc-qr.mjs`](../tools/generate-schoolcalc-qr.mjs) | Action/result QR framebuffer generator |
| [`build-qr-runtime.mjs`](../tools/build-qr-runtime.mjs) | Dynamic Z80 result-QR runtime and fixed structural assets |

The registry currently defines 56 components and 27 required templates, all
covered by 33 exact full-frame compositions. Golden checks cover exact
dimensions, required regions and compositions, component and interaction
semantics, restrained body framing, hardware/F-key separation, text/icon source
validity, QR quiet-zone and uniform-module geometry, fixed-encoder module
equality, cable/QR record equality, checksum failures, and the physical TI-86
static scan test. Dynamic SCQR physical scanning remains a protected-hardware
gate.
