# SchoolCalc Adaptive Study v1 requirements

> **Status:** Canonical product and acceptance specification for the first
> SchoolCalc Adaptive Study release. This document supersedes the v0 product
> scope in [`schoolcalc-requirements.md`](./schoolcalc-requirements.md).
> Existing v0 architecture, component, protocol, and runtime documents remain
> useful implementation research only where this document explicitly retains
> them.

## 1. Release definition

SchoolCalc Adaptive Study v1 is a code-first, agenda-assigned calculator
experience:

```text
Agenda task -> six-digit session code -> one-time relay resolution
            -> adaptive flashcards -> quiz -> QR or cable result
            -> backend closes the study session
```

The learner does not browse a Catalog, choose a profile, open notes or worked
examples, inspect a progress tree, enter a tutor, or launch a native tool in the
v1 flow. Those implementations may remain in source for later releases, but
they are not installed by default and are not reachable from the v1 shell.

The release consists of:

- the `ASCHL` launcher;
- the `SCHLCALC` code-entry shell;
- the adaptive study and A-E quiz path in `SCLEARN`;
- durable continuation and a multi-result outbound queue;
- the Version-5/M result renderer in `SCQR`;
- the calculator-initiated combined sync path in `SCSYNC`;
- one immutable, bank-derived artifact and one device-bound prescription per
  study session; and
- one idempotent backend result importer shared by QR and cable delivery.

The calculator is offline after successful resolution. Study, pause/resume,
quiz, durable result creation, Result display, and QR display must not require
the relay.

## 2. Normative language and ownership

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. The backend is
authoritative for learner identity, agenda authority, bank revision,
curation, session status, grading, and result idempotency. The calculator owns
local input, continuation state, and queued delivery until acknowledgement.

A six-digit code is a navigation claim, not a credential. Resolving it never
grants authority by possession alone.

## 3. Curriculum opt-in and validation

Only a bank-backed curriculum unit with this explicit descriptor is eligible:

```yaml
schoolcalc:
  mode: adaptive_flashcards
  study:
    cardCount: 12
    maxExposuresPerCard: 4
  quiz:
    itemCount: 10
```

The descriptor is validated at the content/application boundary before agenda
issuance. Validation MUST reject the unit rather than silently modifying it
when any condition fails:

1. `mode` is not exactly `adaptive_flashcards`.
2. The unit has no resolvable authored bank or immutable bank revision.
3. `cardCount` is not a positive integer or the bank cannot supply that many
   compatible cards.
4. `quiz.itemCount` is not a positive integer, exceeds `study.cardCount`, or
   the selected items are not compatible A-E multiple-choice items.
5. `maxExposuresPerCard` is outside the inclusive range 1-4.
6. A selected prompt, answer, choice, identifier, or complete artifact cannot
   be represented by the TI-86 codec without clipping, truncation, or loss.
7. The encoded prescription, continuation state, 48-byte durable result draft,
   or 69-byte Version-5/M QR payload exceeds its actual encoded budget.

Compatibility is established from encoded output, not character counts or an
estimate. No compiler, renderer, or transport may silently truncate authored
content.

## 4. Deterministic curation and immutable prescription

For each new study session, the backend selects cards and quiz items in
authored bank order. v1 does not shuffle, use a random seed, or adapt curation
from prior sessions. Within-session scheduling is adaptive; content selection
is deterministic.

The persisted study session and its canonical prescription MUST bind:

- the opaque study-session ID;
- learner ID/key and agenda work-session ID;
- subject, course/unit, and topic identifiers needed to authorize and record
  the work;
- immutable bank identity and exact bank revision/digest;
- selected card IDs in presentation-source order;
- selected quiz item IDs in quiz order;
- `cardCount`, `itemCount`, and `maxExposuresPerCard`;
- grading/pass policy and any policy version;
- immutable artifact ID, digest, TI variable locator, encoded length, and
  required client capability version; and
- the assigned six-digit code and lifecycle status.

Rebuilding an agenda may reproduce a projection, but it MUST NOT recurate or
mutate an existing study session. A bank update affects only newly created
sessions. Artifact storage is first-write-wins by identity.

## 5. Six-digit code lifecycle

The display form is always two groups of three decimal digits, for example
`012 345`. The canonical value is a six-character string; leading zeroes are
significant.

On the calculator, the editable six-digit value MUST use the dedicated
`code-7x8` numeral face. That face is exclusive to this startup handoff: it is
not used for headers, cards, quiz choices, scores, or status copy. The linked
shell table contains only dash and decimal glyphs, preserving the 9 KiB shell
ceiling. A visible gap separates digits three and four.

- Allocate exactly one cryptographically opaque code for each calculator
  study session.
- Never assign a code to different work, even after its session closes.
  Collision checks include all historical assignments.
- Reuse the same code whenever the same open agenda study session is rebuilt.
- A session closes only when the first valid QR or cable result is accepted.
- A passing result closes the session and serves/completes the applicable
  subject work through the ordinary School policy.
- A failing result closes that attempt without serving the subject. The next
  mutating agenda build creates a new remediation study session with a new
  code and a newly persisted prescription.
- Unknown or closed codes do not create work during resolution.

The backend reauthorizes the agenda/work session, learner, unit/topic, bank
revision, client compatibility, and requesting device every time a new code is
resolved. A device-bound prescription obtained by one calculator cannot be
resolved for another calculator without a separately authorized operation.

## 6. Agenda integration

`agenda.mjs` remains a pure policy function. Its inputs may include a validated
SchoolCalc descriptor and its planner output MUST carry that descriptor into
the applicable entry and `section.next`. It MUST NOT perform I/O, allocate a
code, generate randomness, invoke a repository, or depend on wall-clock state.

The mutating agenda builder/application layer performs the side effects:

1. build the pure agenda plan;
2. ensure the existing generic agenda work session;
3. for each eligible task, reuse its open calculator study session or create
   one immutable session from the validated descriptor and current bank;
4. allocate or retrieve its non-reassignable six-digit code;
5. enrich the returned section and printed agenda projection; and
6. persist the mapping transactionally so a retry cannot mint a second code.

The printed and returned applicable task renders:

```text
012 345
Enter on calculator.
```

That handoff replaces the existing subject-next scan token only for the
calculator-enabled task. All other agenda tasks retain their current behavior.

A dry-run/preview executes the pure planning path and performs no writes. It
may display an already-issued code obtained through read-only projection, or
state that the task is calculator eligible; it MUST NOT create a work session,
study session, artifact, code, or reservation.

## 7. Startup and code entry

Every cold or warm launch opens `ENTER CODE`. Profile and Catalog screens are
not normal v1 routes.

- Decimal keys fill six positions and visibly preserve zeroes.
- Each accepted digit replaces only its own 7x8 cursor cell. The other five
  cells, instruction text, header, status, and rail MUST NOT be repainted.
- F1 is blank until all six positions are filled, then becomes `OPEN`.
- `ENTER` and F1 are inert before six digits; either opens the completed code.
- F2-F4 are blank and inert. F5 is `EXIT` at the far right and returns directly
  to TI-OS without altering canonical study state.
- A new code creates a durable resolution request and directs the learner to
  connect the relay once.
- There is no zero-digit Resume route. Resuming unfinished work requires
  re-entering its six-digit code, which opens its exact local state.
- If the code has a locally queued completed result, entering it reopens
  Result/QR and never restarts study or quiz.

Only one unfinished study prescription may occupy calculator continuation
state. Multiple completed, unacknowledged results may coexist in the outbound
queue.

## 8. Durable calculator records

The v1 installed-route `DSCODE`/`SCCO` continuation-code index is inactive and
is not part of the default installation. Adaptive Study uses these records:

| TI variable / magic | Ownership and purpose |
| --- | --- |
| `DSENTRY` / `SCE1` | Durable calculator-owned resolution claim containing exactly the bound `deviceId`, fresh `requestId`, and six-character code plus envelope/version integrity fields. |
| `DSSTUDY` / `SCSP` | Canonical immutable, device-bound study prescription used by `SCLEARN`. |
| `DSSTDNEW` / `SCSP` | Relay-written staged prescription. It is never executable/canonical until validated and committed with its artifact. |
| `DSSYNC` | Commit acknowledgement/manifest written last; authorizes the staged artifact and prescription transaction. |
| alternating local slots / `SCL1` | Calculator-owned 45-byte adaptive continuation created on first launch; only one unfinished study session is retained. |
| existing result queue | One or more immutable adaptive-study result records awaiting QR/cable acknowledgement. |

`DSENTRY` is retained across interruption and all non-success resolution
outcomes. It is cleared only after the calculator validates an exact
acknowledgement of the same device ID, request ID, code, prescription identity,
and artifact identity.

`DSSTUDY` contains enough immutable identity to reject a mismatched artifact,
result, learner, device, or code. The `SCL1` continuation uses the existing
copy-on-write/alternating-slot durability rules and need not be preseeded by the
installer. The rating/exposure update is committed before the next card becomes
visible.

## 9. One-time relay resolution and commit ordering

Combined sync first imports queued results idempotently, then resolves a valid
`DSENTRY`, and finally publishes acknowledged state. The response distinguishes
an already-installed immutable artifact from a missing one and returns the
device-bound learner key with the immutable prescription.

For an installed artifact, the relay transfers only `DSSTDNEW` and its final
acknowledgement/`DSSYNC`. For a missing artifact, the required order is:

```text
validate resolution response
-> write and verify immutable artifact
-> write and verify DSSTDNEW prescription
-> write DSSYNC acknowledgement last
-> calculator commits DSSTUDY
-> calculator clears exactly the acknowledged DSENTRY
```

No earlier write makes the staged prescription selectable. Artifact digest,
length, locator, client capability, available RAM, prescription identity, and
all envelope checks must pass before `DSSYNC` is written.

Power loss, cable removal, cancellation, timeout, or an invalid response leaves
the prior artifact, prior canonical `DSSTUDY`, continuation, and result queue
usable. A retry uses the same request ID and code until acknowledged.

Plain recovery outcomes are required:

| Resolution outcome | Calculator behavior |
| --- | --- |
| unknown code | `CODE NOT FOUND` and retain `DSENTRY` for correction/retry |
| completed/closed code | `SESSION CLOSED`; never install or restart it |
| unauthorized learner/unit/device | `NOT AUTHORIZED`; retain prior canonical state |
| incompatible client or artifact | `UPDATE SCHOOLCALC`; retain prior state |
| insufficient verified memory | `NOT ENOUGH MEMORY`; do not remove prior usable content |
| interrupted/invalid transfer | `SYNC INTERRUPTED - TRY AGAIN`; ignore uncommitted staging |

While waiting for the first relay response, the calculator MUST show a visibly
changing indeterminate link indicator so a learner can distinguish active
polling from a frozen calculator. The indicator MUST NOT imply byte or percent
progress before a verified handshake. After connection, it is replaced by the
verified direction/phase and determinate item progress. Every terminal state
MUST say whether the transfer completed or stopped and whether it is safe to
unplug.

Codes are never logged as credentials or used to bypass relay/device
authentication. Relay HTTP authentication and the protected TI electrical/link
layers remain as previously specified.

## 10. Adaptive study interaction

Each flashcard is a stable one-pixel framed surface between the header and
softkey rail. Text-only faces center every prewrapped line horizontally and
center the complete line block vertically; paging never changes the border or
rail geometry.

An item MAY author target-neutral vector art on either face:

```yaml
schoolcalc:
  promptGraphic:
    primitives:
      - { type: line, x1: 10, y1: 90, x2: 50, y2: 10 }
      - { type: line, x1: 50, y1: 10, x2: 90, y2: 90 }
      - { type: line, x1: 90, y1: 90, x2: 10, y2: 90 }
      - { type: label, x: 47, y: 45, text: x }
  answerGraphic:
    primitives:
      - { type: circle, cx: 50, cy: 50, radius: 35 }
```

Coordinates are integer percentages in the inclusive range 0-100, independent
of calculator pixels. Supported semantic primitives are `line`, `polyline`
(2-16 points), `rect`, `circle`, `point`, and a 1-12 printable-ASCII-character
`label`. A face contains 1-24 primitives. Rectangles and circles MUST remain
inside normalized bounds. The TI-86 adapter expands semantic shapes into line
and label bytecode, maps them to the upper card canvas, and rejects a face that
exceeds 160 actual encoded bytes or whose label escapes that canvas. It never
clips or drops a primitive. Graphic faces reserve the lower card band for a
horizontally centered, at-most-two-line prompt/answer caption. Text-only faces
retain full-card centering.

The front and back of a card use these exact softkey rails:

| Surface | F1 | F2 | F3 | F4 | F5 |
| --- | --- | --- | --- | --- | --- |
| front | `FLIP` | blank | blank | blank | blank |
| back | `FLIP` | blank | `AGAIN` | `HARD` | `KNOW` |

F2 is visually blank and has no behavior on both surfaces. A rating is accepted
only on the back. `FLIP` is reversible and does not count as another exposure.
The visible face and its fully rendered opposite face remain resident as a
two-surface cache. F1 swaps those complete card bodies immediately in either
direction; content decoding, line layout, vector rendering, and durable writes
MUST NOT precede the visible swap.

The initial active queue is authored card order. Showing a card increments its
exposure count. After its back is shown:

- `AGAIN` records the final current rating and makes the card eligible only
  after two other card presentations;
- `HARD` records the rating and makes it eligible only after four other card
  presentations;
- `KNOW` records the rating and retires the card; and
- reaching `maxExposuresPerCard` without `KNOW` retires the card as unresolved
  after recording its last rating.

Pressing `AGAIN`, `HARD`, or `KNOW` MUST immediately clear the card and show a
centered `LOADING...` acknowledgement before persistence, scheduling, or next
surface rendering. That stable acknowledgement remains visible until the next
card or study summary is complete.

Eligibility is measured in intervening presentations, not wall-clock time.
When several cards are eligible, choose the earliest scheduled due position,
breaking ties by authored order. If every active card is cooling down, advance
the scheduler ordinal directly to the earliest due card; this is the sole
cooldown exception. Do not render a fake wait or invent card presentations,
exposures, or telemetry for the skipped ordinal positions.

`EXIT` safely pauses after committing the current stable state. Relaunch returns
to Enter Code; re-entering the same six-digit code must reproduce the exact next
eligible card and must not double-count the last visible exposure or rating.

## 11. Study summary, quiz, and local completion

After every card retires, show a compact summary with an explicit numeric count
for each of known, hard, again, and unresolved. Labels without values are not a
summary. `F5 QUIZ` starts the one prescribed quiz. There is no same-session
restudy or remediation loop.

The quiz:

- labels every prompt and choice screen `QUIZ: <subject>` using the immutable
  artifact subject, with the item position retained at right;
- uses the persisted quiz IDs and order;
- presents exactly one A-E choice per item;
- records one four-bit choice value per item;
- does not ask the relay for hints, alternate items, or grading; and
- computes local score evidence using the exact prescribed artifact.

The calculator MUST durably append the result before showing success, Result,
or QR. After queueing, the learner may return to Enter Code; the unacknowledged
result remains deliverable. Re-entering its code opens Result. A local result
does not itself mark the backend session closed.

## 12. Compact result and encoded-size limits

The adaptive-study result is a mode of the canonical result envelope consumed
by the same importer as other SchoolCalc results. Its logical content includes:

- version/mode and integrity fields;
- six-character session code;
- one four-bit card summary per prescribed card, packing the final rating and
  the exposure count 1-4;
- one four-bit A-E quiz choice per prescribed quiz item; and
- item count, locally computed score/correct count, and local completion
  evidence required to detect inconsistent submissions.

Two nibbles share each byte, with the earlier authored card/item in the high
nibble. A card nibble uses bits 3-2 for final rating (`00` reserved/invalid,
`01` AGAIN, `10` HARD, `11` KNOW) and bits 1-0 for `exposureCount - 1` (values
0-3 represent counts 1-4). A non-KNOW card at its authored exposure cap is the
unresolved retirement case; a non-KNOW value below the cap is invalid in a
final result. A quiz nibble is `1`-`5` for A-E; `0` is permitted only as an
unanswered in-progress draft and is invalid in a final result. Values `6`-`15`
are invalid. If either array has an odd count, the unused low nibble in its
last byte is canonical zero. Counts come from the prescription and are
validated before decoding arrays. A rating/exposure combination outside the
prescribed limits, an invalid quiz-choice nibble, or score evidence
inconsistent with the exact artifact is rejected.

The durable in-progress draft MUST encode to at most 48 bytes. The final QR
payload MUST encode to at most 69 bytes, the binary payload ceiling selected
for a Version-5 QR symbol at error correction level M. Both limits apply to the
actual byte sequence passed to storage/QR encoding, including headers,
identifiers, counts, integrity fields, and padding. A unit that cannot meet
both limits is ineligible; runtime truncation is forbidden.

`SCQR` renders exactly one standards-compliant Version-5/M symbol for the
selected immutable queued result. QR display never acknowledges or deletes the
queue record.

## 13. Import, grading, and session closure

QR and cable delivery invoke the same application importer with transport
metadata outside the canonical result identity. Import performs, in order:

1. decode and validate the exact result bytes;
2. resolve the permanently assigned session code;
3. reauthorize session, learner, unit/topic, device binding, artifact, bank
   revision, and policy;
4. validate telemetry counts/ranges and recompute quiz score from the immutable
   artifact rather than trusting local score evidence;
5. atomically claim the result idempotency key and close the open study
   session; and
6. apply pass/fail agenda consequences.

The first valid result for an open session is accepted. Redelivery of identical
canonical bytes is `duplicate` and returns the original acknowledgement.
Different bytes/work for that closed session are `conflict` and never replace
the accepted result. Invalid or unauthorized submissions do not close the
session.

On cable acknowledgement, remove only the exactly acknowledged queue item
using the existing backup-first queue transaction. QR submission may be
acknowledged later through combined sync; merely displaying or scanning a QR
does not mutate calculator state.

## 14. Release packaging boundary

The default v1 installation contains only `ASCHL`, the `SCHLCALC` shell,
adaptive `SCLEARN`, `SCQUEUE`/result queue support, `SCQR`, `SCSYNC`, required
durable state, fonts, and shared record/transport infrastructure. Its
digest-pinned manifest MUST list every installed program and initial variable.

The following remain in source and may be built as diagnostics or future
optional bundles, but are omitted from the default v1 installation and cannot
be dispatched by the v1 shell: `SCCAT`, `SCREQ`, `SCPROF`, `SCTUTOR`,
`SCNATIVE`, Catalog snapshots, roster/progress projections, `DSCODE`, and
lecture-note/example/native-tool routes.

No inactive executable or data variable may be required for cold launch,
resolution, study, quiz, queueing, QR, or sync.

## 15. Acceptance requirements

### 15.1 Domain and application

- Reject invalid opt-in descriptors and all actual encoded-size overflows.
- Prove `agenda.mjs` carries the descriptor into entries and `section.next`
  without I/O, RNG, repository access, or mutation.
- Prove a mutating agenda build creates one immutable study session/code and
  repeated builds reuse it.
- Prove preview performs zero writes and never reserves a code.
- Prove curation is exact authored order and retains the bank revision.
- Prove accepted pass serves the subject; accepted failure causes the next
  agenda build to issue a new remediation session/code.
- Prove no historical code is reassigned.

### 15.2 Codec and relay

- Resolve an installed artifact using prescription plus acknowledgement only.
- Resolve a missing artifact in artifact -> staged prescription -> `DSSYNC`
  order.
- Exercise result pulls, power cuts at every write boundary, exact duplicates,
  conflicting second results, unknown/closed codes, insufficient memory, and
  cross-device attempts.
- Round-trip packed card rating/exposure nibbles, quiz choices, and score
  evidence at minimum, maximum, and one-byte-over-limit boundaries.
- Prove 48-byte draft and 69-byte QR limits against actual encoder output.

Actual relay download transactions run in the virtual-relay and TilEm lanes.
Stock MAME cannot emulate the TI-86 port-7 peer and is not evidence for the
download transaction itself.

### 15.3 Named exact-binary calculator scenarios

`ti86.cli.mjs --case-id` transcripts and promoted
`testing/mame-scenarios.yml` cases cover:

1. cold launch directly to `ENTER CODE`;
2. unknown local code creating/retaining a one-time relay request;
3. a pre-resolved code opening the exact learner/topic prescription;
4. `AGAIN` returning after two intervening presentations;
5. `HARD` returning after four intervening presentations;
6. F2 remaining visually and behaviorally blank on card front and back;
7. power-safe pause, relaunch to Enter Code, and six-digit-code resume;
8. study completion -> quiz -> durable result -> Version-5/M QR;
9. re-entering a locally completed code reopening Result; and
10. no profile, Subject, Catalog, lesson-menu, notes, examples, tutor, progress,
    or native-tool screen being reachable.

Assertions use semantic text/symbol extraction in addition to necessary pixel
checks. `ti86.cli.mjs` must decode a retained result so a case can assert its
session code, per-card final rating/exposure, quiz choices, and score rather
than inferring correctness from LCD pixels.

## 16. Explicitly outside v1

- calculator-side Catalog discovery or content installation choices;
- profile selection, Guest mode, or learner switching;
- notes, worked examples, generic lesson menus, progress trees, realtime
  tutoring, native calculator handoff, or optional keyboard interaction;
- same-session remediation or a second quiz attempt;
- cross-session mastery adaptation; and
- compatibility with the v0 `DSCODE`/`SCCO` continuation-code wire format.

Future releases may change curation policy while preserving the immutable,
persisted prescription contract. They must use a new explicit capability or
format version when the calculator-visible semantics change.
