# Piano Flashcards: per-user tiers, chord cards, and in-session chrome

**Date:** 2026-07-21
**Status:** Design — validated in conversation, not yet implemented
**Scope:** `frontend/src/modules/Piano/` (PianoFlashcards, theory, Games host) + `piano.yml`

---

## Problem

Three separate gaps, one feature area:

1. **Every kid gets the same flashcards.** The kiosk knows who is playing, but the games
   don't. A 12-year-old grinds "White Keys" alongside a 6-year-old.
2. **No chord training.** Flashcards ask for note *positions* (`single`/`dyad`/`triad` =
   a count of random pitches). Nothing ever asks for "G7" as a musical idea, and nothing
   trains chord-symbol reading at all.
3. **The chrome is hollow.** Score accumulates toward an abstract threshold, level-ups
   happen silently, and the completion screen erases itself after five seconds.

Explicitly **out of scope**: cross-session persistence of *results*, and the coin economy.
The chrome is in-session only.

**Not out of scope, contrary to an earlier draft of this doc: backend work.** Tiers need
two backend edits (see Part 1). An earlier version claimed "no backend work" after tracing
identity only as far as the React context; that was wrong.

---

## What already exists

Established by inspection, not assumed:

| Capability | Where | State |
|---|---|---|
| Roster + current player | `PianoKiosk/PianoUserContext.jsx:16` | Works. Persists per-piano in `localStorage`; Guest fallback in `pianoUser.js:2`. |
| Roster config | `piano.yml` → `users.primary` | Flat id list: `[kckern, elizabeth, felix, milo, alan, soren]`. |
| Chord identification | `theory/chordNaming.js:139` | Strong. Inversion-aware, tolerant of a dropped 5th, 26 qualities, well tested. |
| Chord display stability | `components/useStableChord.js` | 80ms onset settle, 500ms release linger. |
| Staff prompt rendering | `components/ActionStaff.jsx` | Renders target pitches. |
| Keyboard target highlight | `components/PianoKeyboard` | Accepts `targetNotes` / `wrongNotes`. |
| Game state machine | `PianoFlashcards/useFlashcardGame.js` | IDLE → PLAYING → COMPLETE, levels, scoring. |

**Plumbing gap 1 (frontend):** `GameHost` (`Games.jsx:84`, render at `:111-122`) passes
`activeNotes`, `noteHistory`, `gameConfig`, `onDeactivate`, `onNoteOn/Off` — and no user.
It already renders inside `PianoUserProvider`, so this part is a `usePianoUser()` call.

**Plumbing gap 2 (backend) — this one is load-bearing and was missed:**
- `UserService.hydrateUsers` (`backend/src/0_system/config/UserService.mjs:56`) returns
  object-form entries **as-is**. So `{ id: felix, tier: chords }` skips profile hydration
  entirely — no `display_name`, no `group_label`. Adopting the YAML below without fixing
  this *breaks Felix's user chip*.
- `getRoster` (`backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs:87`) maps to
  `{ id, name, group_label }`. `tier` is dropped before it ever reaches the API.

Both must be fixed or Part 1 does nothing at all.

**Confirmed absent:** no game writes anything anywhere (zero `DaylightAPI`/`fetch` calls
across all five game directories), and no game touches the economy. The coin economy is a
no-op regardless — `EconomyService` reads `data/household/config/economy.yml`, which does
not exist, so every `earn()` silently skips.

---

## Part 1 — Per-user difficulty tiers

`users.primary` accepts an object form alongside bare strings. Each flashcard level is
tagged with the tier it belongs to.

```yaml
users:
  primary:
    - milo                            # bare string still valid — defaults to first tier
    - alan
    - { id: felix, tier: chords }
    - { id: elizabeth, tier: chords }

games:
  flashcards:
    levels:
      - { name: "Note Names",   tier: notes,  complexity: single, prompt: text  }
      - { name: "White Keys",   tier: notes,  complexity: single, prompt: staff }
      - { name: "All Dyads",    tier: notes,  complexity: dyad,   prompt: staff }
      - { name: "Triads",       tier: chords, complexity: triad,  prompt: staff }
      - { name: "Chord Symbols", tier: chords, complexity: chord, prompt: text,
          qualities: [major, minor] }
```

A user's tier selects their **starting index** — the first level carrying that tier — and
they continue upward through every level after it. One ordered array, no duplicated level
definitions; adding a tier is one line. Milo starts at "Note Names"; Felix skips straight
to triads and never re-grinds single notes. Guest gets the first tier.

**Rejected alternative:** separate `tiers: { beginner: { levels: [...] } }` blocks. Cleaner
to read, but duplicates every shared level definition and drifts on edit.

**Rejected alternative:** earned/persistent tiers. Deliberately not built — assigned tiers
need no storage, and cross-session progress is out of scope.

---

## Part 2 — Chord cards

### The card

New `complexity: chord`. The target is a *chord identity* (root + quality), not a fixed set
of pitches. The player plays any voicing; `identifyChord()` grades it.

This inverts the existing cards. `complexity: triad` shows three noteheads and asks the
player to reproduce those exact pitches — sight-reading. `complexity: chord` names a chord
and asks the player to *know* it. A kid who can play a written triad frequently cannot play
one when told "G7," and that is the gap this closes.

### Vocabulary

`chordNaming.js` already knows 26 qualities — triads, sus, adds, the full seventh family,
ninths, `♯11`s, `6/9`, power. Levels name pools from it:

```yaml
qualities: [major, minor]                          # starting out
qualities: [major7, dominant7, minor7, minor7b5]   # sevenths
qualities: [sus2, sus4, dominant7sus4]             # sus
qualities: [add9, minorAdd9, add4, minorAdd4]      # adds
```

`TEMPLATES` is currently module-local. It needs to export a `CHORD_QUALITIES` list (so
levels can be validated against real qualities) and gain `voiceChord(root, quality)` —
today the theory module only runs notes→name, and cards need name→notes.

### Difficulty dials, free from the model

- **`qualities`** — the pool.
- **`inversion: any | required`** — accept any voicing, or require `D minor 7 / F`
  specifically. `identifyChord` already returns `inversion`, so this is a comparison.
- **`prompt`** — see Part 3.

### Grading must settle

`evaluateMatch` (`flashcardEngine.js:29`) returns `'wrong'` the instant any non-target key
is down, and `useFlashcardGame.js:78` immediately sets `cardFailed`. Chords are not played
simultaneously — a rolled chord marks itself wrong mid-roll before the player finishes.

**Do not reuse the 80ms from `useStableChord`.** That constant was tuned for *display*
smoothing — deliberately below the perception threshold so the readout feels instant.
Grading is a correctness path with the opposite requirement. A child rolling G7 bottom-up
passes through a stable, fully-named, wrong-quality `G major` for the entire gap before the
F lands, and for a small hand that gap is 150-400ms. An 80ms grader flunks the roll exactly
like today's code, just 80ms later.

Grading policy, which must be stated explicitly because it *is* the feature:
- **Never issue `wrong` on a partial chord.** Only evaluate once the sounding note count
  reaches the target's, or on release — whichever comes first.
- **Grade against an acceptance set, not a single best name.** `identifyChord` returns one
  winning reading; a correct-but-thin voicing can name as something else. Real case, verified:
  a rootless C6/9 (`C-E-A-D`, dropped 5th — a voicing the tolerant tier explicitly blesses)
  names as `A minor add4 / C`. Comparing `root`+`quality` against the single best name marks
  that correct playing wrong, forever. This is pre-existing engine behavior, not new.
- `inversion` is compared only when the level sets `inversion: required`.

---

## Part 3 — Prompt modality

Presentation is an axis independent of the target. Every card has a *target* (what to play)
and a *prompt* (how it's asked), and they vary separately:

| | `prompt: staff` | `prompt: text` |
|---|---|---|
| `complexity: single` | notehead → find the key (sight-reading) | `F♯` → find the key (**letter names**) |
| `complexity: chord` | notated chord → play it | `D minor 7` → play it (**chord symbols**) |

`prompt: text` is the lead-sheet / chord-chart skill, and nothing in the app trains it
today. It also lets single-note cards drill letter names, which nothing does either.

Rendering: `staff` keeps `ActionStaff`. `text` is a new plaque component — `ChordNamePanel`'s
existing styling is the obvious starting point.

---

## Part 4 — Note spelling (sharps and flats)

`PITCH_CLASS_NAMES` (`chordNaming.js:21`) is sharp-only, so the app can only ever say
`A♯ minor` — never `B♭ minor`. This is wrong on **both** sides: it limits what flashcards
can teach, and it makes the live `ChordNamePanel` readout misspell real chords.

Fix it in the theory module so both consumers inherit it.

```js
export const PITCH_CLASS_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const PITCH_CLASS_FLATS = ['C','D♭','E♭','E','F','G♭','G','A♭','A','B♭','B','C♭'];
```

`identifyChord` has no key context, so the live readout uses a convention-based,
quality-aware default — which is how lead sheets actually spell:

```
majors & dominants lean flat:   D♭  E♭  A♭  B♭     (not "D♯ major")
minors lean sharp:              C♯m F♯m G♯m        (not "D♭ minor")
```

Flashcard cards may carry an explicit `spelling: sharp | flat` when a level wants to drill
one deliberately, so kids meet both names for the same key.

**Grading is unaffected** — `identifyChord` matches on pitch class, so spelling is
display-only. `B♭ minor` and `A♯ minor` grade identically.

Holes in the rule as sketched above, which must be closed before implementing:
- The flat table has twelve slots but the convention names only five black keys. Say which
  seven are identity, or a flat-leaning quality rooted on B emits `C♭ major` on a kid's card.
- "Minors lean sharp" yields **D♯ minor**, where E♭ minor is the standard lead-sheet
  spelling. The rule as stated gets a real case wrong.
- Diminished, augmented, sus and half-diminished are unmentioned, and the live panel emits
  `minor7b5` names today. Which way do they lean?
- **Slash bass spelling is not covered at all** — the root spells by quality convention, and
  the bass spells by… nothing specified. That is the visible half of every inversion name.

**Rejected alternative:** full key-signature-aware enharmonic spelling. Musically correct,
but needs a key concept threaded through level config and real enharmonic logic. The
convention table covers the overwhelming majority of real chord symbols for a fraction of
the work.

---

## Part 5 — In-session chrome

### What's wrong

| Today | Problem |
|---|---|
| `score_per_card: 10` → `score_to_advance: 100` | Abstract. "100 points" means nothing to a kid; "4 more cards" does. |
| 20 dots + rolling accuracy (`AttemptHistory.jsx`) | Pure history. No *run* — nothing says "6 in a row, don't break it." |
| Level-up = silent `setState` (`useFlashcardGame.js:107`) | The biggest moment in the game has no moment. |
| `"Training Complete!"` → `createInitialState()` after 5s (`:135`) | Ends by erasing itself. |
| `fc-flash-green` / `fc-shake` | The entire reward vocabulary is two 0.3s CSS animations. |
| — | **Silent.** On a piano. No chime on hit; chord cards never let you *hear* what you spelled. |
| Miss → shake, repeat forever | Untimed with no reveal — a kid who doesn't know G7 is simply stuck. |

### What to build

1. **Streak as the primary meter.** Replace score-as-number with a visible run, escalating
   at 3 / 5 / 10 with rising visual heat. A streak is the thing you don't want to break,
   and it self-calibrates to any tier — no per-level threshold tuning.
2. **Level-up as a real interstitial.** The new level's name lands as a card, with a sound.
   Half a second of ceremony instead of zero.
3. **Audio feedback.** Chime on hit. On chord cards, sound the correct chord on reveal, so
   the *name* attaches to a *sound* rather than to finger positions.
   **Resolve this first — it may be physically inaudible.** The piano tablet has
   `STREAM_MUSIC` pinned to 0 as a permanent guard, and that lever is exactly what kills
   WebView audio. A chime almost certainly has to leave as MIDI through the piano-bridge
   synth path, not an `<audio>` element. This decides the chrome's architecture; it is not
   an implementation detail to settle later.
4. **Reveal after 3 misses.** Light the target on the keyboard — `PianoKeyboard` already
   accepts `targetNotes`, currently only passed on `hit` (`PianoFlashcards.jsx:32`). Turns
   a wall into a lesson. **There is no miss counter to build on:** `cardFailed` is a one-shot
   boolean and `cardStatus` resets whenever all keys are released
   (`useFlashcardGame.js:90-95`). Define the unit of "a miss" — one press with wrong keys?
   one release-to-release attempt? — or this is unimplementable as written.
5. **Completion that doesn't self-erase.** Hold the summary until the player leaves,
   instead of the 5s wipe.

Progress display shifts from `score / score_to_advance` to cards-remaining. `score_to_advance`
stays in config as the underlying threshold; only the presentation changes.

---

## Prerequisite landed — and the wrong turn taken on the way

### What was tried, and reverted

Commit `722f2568e` removed the `sixth` and `minor6` templates so that `F-A-C-D` would name
as `D minor 7 / F` instead of `F 6`. The stated justification was that a sixth chord shares
its pitch-class set with a minor 7th rooted a minor 3rd below, so the set should have "one
name."

**That justification was false, and the change is reverted.** This module resolves shared
pitch-class sets by the BASS everywhere else — verified in the same file:

```
C D G  (bass C) -> "C sus2"      G C D  (bass G) -> "G sus4"
C Eb Gb A       -> "C dim 7"     Eb Gb A C       -> "D# dim 7"   (one set, four names)
```

Sixths were doing exactly the same thing, correctly. C6, F6 and Am6 are common chords, and
deleting them also meant chord flashcards could never drill a sixth (Part 2) — a real hole
in lead-sheet vocabulary. Both templates are restored with root-position priority intact.

### The bug it exposed, now fixed

The removal surfaced a genuine pre-existing flaw: a reading whose chord tones did **not**
contain the sounding bass could outrank one that did, and then display as root position.

```
C C# E A   ->  "A major"     # contains neither the bass C nor the C#, and no slash
```

Cause: `inversionOf` returned `0` for a bass that is not a chord tone — indistinguishable
from real root position — and `pickBest` sorts on low inversion. Fixed by:
- `inversionOf` now returns `-1` for a foreign bass instead of lying with `0`.
- `pickBest` ranks `explainsBass` **first**, ahead of root position.
- The display slashes whenever `bass !== root`, covering inversions and foreign basses alike.

This also improves unrelated readings — `D + A C♯ E` now resolves to `A add4 / D` (the D is
the added 4th) rather than discarding the bass.

Verified: 42/42 in `chordNaming.test.js`, 2196/2196 across the Piano module. No code outside
the theory module reads `.inversion`, so the semantic change is contained.

### Note on the original complaint

`F-A-C-D` with F in the bass names `F 6` again. That is the textbook F6 voicing, and it is
the behavior the sus/dim7 precedent demands. If the minor-7 reading is still wanted for the
live readout specifically, the right shape is a **display preference on `ChordNamePanel`**,
not a change to the shared vocabulary.

---

## Build order

Each step is independently shippable and testable.

1. **Spelling** — `PITCH_CLASS_FLATS` + `spellRoot(pc, quality)`. Pure theory, unit-tested,
   improves the live `ChordNamePanel` immediately with no flashcard work.
2. **Theory exports** — `CHORD_QUALITIES`, `voiceChord(root, quality)`. Pure, unit-tested.
3. **User → game plumbing** — `usePianoUser()` in `GameHost`, `tier` in `users.primary`,
   `tier` on levels, starting-index resolution. Testable without any new card type.
4. **Chord cards** — `complexity: chord`, settle-window grading, `inversion` dial.
5. **Prompt modality** — `prompt: text` plaque component; wire `prompt` through levels.
6. **Chrome** — streak meter, level-up interstitial, audio, reveal-on-struggle, persistent
   completion.

Steps 1–2 are pure functions with no UI risk and should go first. Step 3 unblocks tiers
independently of chord work. Step 6 is the largest and benefits from 4–5 existing to feel.

---

## Unresolved — must be settled during implementation, not invented at the keyboard

**Chord cards break three components that assume fixed target pitches.** `complexity: chord`
has no `pitches` until the player plays, but all three consume `currentCard.pitches`:
`targetNotes` highlighting and `wrongNotes` computation (`PianoFlashcards.jsx:32-46`), and
`ActionStaff` rendering (`:85-89`). Each needs a per-mode branch.

**`voiceChord` has no stated range policy.** Which octave does it pick? Is it constrained to
the level's `note_range`? And what does `computeKeyboardRange` (`PianoFlashcards.jsx:26-29`)
show for a card whose pitches aren't fixed?

**Tier restart semantics.** `createInitialState()` returns absolute level 0 and `startGame`
(`useFlashcardGame.js:158-161`) hardcodes it, so a `chords`-tier kid who finishes the game
restarts at "Note Names". The tier start index has to thread into both.

**Tier ordering is implicit in array position.** Reordering levels in YAML silently
reassigns every kid's starting point, with no validation. At minimum, warn when a tier tag
is missing or appears after a later tier. Also undefined: whether a `chords` kid should play
`notes` levels that an editor later appends below their start.

**Card sequencing.** `generateCardPitches` is random with replacement — the same card can
repeat back-to-back today, and will for chord cards too. No anti-repeat rule is specified.

**`prompt: staff` for chord cards depends on Parts 2 and 4 simultaneously** — rendering a
notated chord needs both a voicing and correct staff spelling. The build order below does
not currently capture that coupling.

**Audio path** (see Part 5) — piano sound bundle vs. separate SFX, decided against the
`STREAM_MUSIC = 0` constraint.

**Inversion prompts** — should `inversion: required` show the slash in the prompt
(`D minor 7 / F`), or state the requirement separately? The former is realistic notation;
the latter is clearer for a kid meeting inversions for the first time.
