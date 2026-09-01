# The Ask Platform — Roadmap

**Date:** 2026-08-28
**Approved:** by the user, as the session goal, verbatim from the executive summary.
**Goal:** one challenge system for the piano that any screen can use, fully driven by
config — instead of logic wired into the games gate specifically.
**Principles (user-stated):** config-driven, single source of truth, separation of
concerns, DRY.

## The three concepts

- **The Ask** — what is played, how it is shown, how it is judged. Formalized as the
  nine-axis taxonomy (below).
- **The Host** — where an ask lives; what summons it onto a screen.
- **The Stake** — what passing enables and failing costs. A *gate* is a host whose stake
  is access. Stakes (MECE): `access · progression · completion · currency · none`.

Hosts differ only in **trigger, stake, and policy owner**. The pipeline underneath —
resolve material → present → grade → record — is one substrate: **AskSession**.

## The nine ask axes (MECE)

1. **Texture** — `unison · chord · line · polyphony` (events × notes-per-event; sizes
   are parameters).
2. **Hands** — `right · left · both · either`.
3. **Source** — `synthesized` (note count, register) · `bank` (family → family's own
   parameters: root, mode/quality, direction, octaves, inversion) · `score` (source id,
   measure range). Parameters nest only under the source value that owns them.
4. **Prompt** — the one primary channel: `follow` (lit keys) · `recall` (language) ·
   `read` (notation).
5. **Secondary surface** — `none · staff · keyboard-strip` (the primary surface is
   determined by prompt).
6. **Notation style** — whenever a staff renders: `sequence · engraved · score`.
7. **Timing** — `free · pulsed · cued`.
8. **Judging** — ordered, cumulative: `completion · clean · placed`.
9. **Hint policy** — `none · after-stall · always` (escalation toward `follow`).

Constraints (executable, in the schema): `placed ⇒ cued ⇒ note values + usable tempo`;
`score` source ⇒ style `score`; `recall` ⇒ source ≠ `score`; `sequence` style ⇒ one
clef, one hand, ≤ 2 octaves; `polyphony` ⇒ `engraved`/`score`; the floor tuple
⟨unison, either, synthesized(1), follow, none, —, free, completion, —⟩ is unremovable.

## Host inventory and stake map

| Host | Trigger | Stake | Lands in |
|---|---|---|---|
| Match gate (Games) | match boundary | access | live; SP1 re-seats it |
| Practice room | child chooses | none | live; SP1 re-seats it |
| Program steps | step reached | progression | live; SP1 re-seats it |
| Video checkpoints | course checkpoint | progression | live; SP1 re-seats it |
| Placement | first gate / on demand | none + writes startLevel | SP3 |
| Today's-lesson gate | kiosk home render | access | SP3 |
| School piano lesson | school day plan | completion (feeds Games gate 1) | SP3 |
| Earned time (D14) | after a pass | currency (mints minutes) | SP3 |

## The four sub-projects

Each is independently shippable, its own spec → plan → SDD cycle. Order fixed
(user ruling: full abstraction first).

### SP1 — the foundation (no visible change)

`askSchema.js`: the grammar above as a validated schema — validation, preset expansion
(today's tiers become named presets), and the constraint table, all executable and the
single source from which resolution and documentation derive. `runPresentation`'s
tier-derivation becomes tuple-resolution. **AskSession** extracted from the
`GameGate`/`ExerciseRun` smear: material resolution and requirement-building leave the
gate; the gate keeps ladder state, rotation, stake panels. All four existing hosts
mount AskSession; program-step and video-checkpoint framing arrive with the extraction
(closing bug-report C1 fully). The ladder is gate-host state, never session state.
Exit: today's whole suite green byte-for-byte; Chromium authority unchanged; the only
visible delta is the two framing lines C1 was about.

### SP2 — the missing presentations

`recall` prompt (no lights; the ask line names the target) + hint policy
(`after-stall` lights the keys *before* the 20s fail-stall) + the **`pitchClass`
policy flag on the held matcher** (user ruling: engine flag, not target expansion, not
a second grader) with optional bass-note check for inversions — landing with recall,
its first consumer. `engraved` notation style for free timing. Single-note staff card.
One Chromium scenario per new cell. Exit: User_5's named-chord flashcard level and
User_3's engraved scales are YAML edits.

### SP3 — the four new hosts

Each a thin adapter — trigger + stake + config, zero presentation or grading code:
placement (a short descending probe writing `startLevel`), today's-lesson gate
(the kiosk home poses a real ask), school piano lesson (result posts to school's
ledger; the piano side of `getPianoLessonGate`), earned time (`onPassed(result)` mints
minutes scaled by score into the budget service; the reserved `earned` source).

### SP4 — configuration and content

The household YAML speaks the full grammar (presets as sugar); the kids' assignments
expressed exactly as spoken (User_2: single lit note; User_5: named chords, any voicing;
User_4: C major on a staff; User_3: engraved G/D/F). Bank content: chromatic scale,
harmonic/melodic minor, warm-up figures. Reference docs generate their tables from
`askSchema.js` so they cannot drift.

## Current live state this roadmap starts from

Gate live for all five users (kckern L2/chess-only, user_3 L2, user_5 keys-2 interim,
user_2 keys-1, user_4 L1); household default off; ladder self-correcting (20s stall eases,
3 clean passes climb); the deferred-minor backlogs of the two shipped branches are
triaged in their SDD ledgers.
