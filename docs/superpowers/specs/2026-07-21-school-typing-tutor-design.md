# School Portal — Typing Tutor

**Status:** Design spec, 2026-07-21.
**Parent requirements:** `2026-07-21-portal-homeschool-requirements.md`
**Depends on:** slice 1 (identity), shipped.
**Modelled on:** `frontend/src/modules/Piano/PianoSpaceInvaders/` (engine/hook/view split) and Mavis Beacon (curriculum and weak-key targeting).

---

## 1. Goal

A child learns to touch-type on the Portal, with a structured curriculum that
tracks which keys they are actually weak on, and an arcade mode that is fed by
those same weaknesses rather than being decorative.

---

## 2. The synthesis, and why it is two modes

Taking the best of each honestly means acknowledging what each is bad at.

**Mavis Beacon's real value was never the game.** It was the curriculum —
home row first, reach keys added deliberately, and drills that noticed which
keys you kept fluffing and gave you more of them. Its arcade sections were a
reward, not the teaching.

**A falling-word game alone is not a tutor.** It is fun and it builds speed on
words you already type well, but it teaches nothing specific and quietly avoids
your weak keys, because you type what you can.

So: **Drill is the tutor. Arcade is the motivation, and it reads the drill's
data.** The falling words in arcade are generated to over-represent the keys
the child's own drill history shows they are weakest on. That connection is the
whole design — without it this is just two unrelated screens.

---

## 3. Mode 1 — Drill (the tutor)

- **Progressive lessons.** Home row → index reaches → upper row → lower row →
  capitals/shift → punctuation → numbers. Each lesson names the keys it
  introduces; earlier keys keep appearing so nothing is learned and dropped.
- **Real words, not letter soup**, as soon as the available key set allows one.
  `asdf jkl;` is unavoidable at lesson one; by lesson three it should be
  words. Typing prose is what transfers.
- **Live feedback**: the target line, the caret position, a correct/incorrect
  mark per character, and a running WPM and accuracy.
- **Finger guidance**: an on-screen keyboard map highlighting the next key and
  which finger owns it. This is Mavis Beacon's genuinely good idea and it is
  cheap — a static key→finger map.
- **No backspace-to-fix by default.** Touch typing is trained by continuing,
  not correcting. Errors are recorded and the drill moves on. (Configurable —
  see §7.)

Lessons are data, hand-authorable like question banks:

`data/content/typing/{lessonId}.yml`

```yaml
id: home-row-1
title: Home row — asdf jkl;
order: 1
introduces: [a, s, d, f, j, k, l, ';']
lines:
  - 'asdf jkl; asdf jkl;'
  - 'dad fad lad sad; all fall'
target_wpm: 12
target_accuracy: 90
```

---

## 4. Mode 2 — Arcade (the motivation)

Modelled directly on `spaceInvadersEngine.js`: words descend, the child types a
word to destroy it, a miss costs health, levels tune difficulty.

What carries over from the Piano engine's design (not its code — different
domain):

| Piano concept | Typing equivalent |
|---|---|
| Falling note with `fall_duration_ms` | Falling word, same per-level duration knob |
| `processHit(state, pitch, …)` | `processKeystroke(state, char, …)` |
| Hit quality → score | Per-word completion speed → score |
| `TOTAL_HEALTH` meter | Same — a word reaching the floor costs health |
| `evaluateLevel(score, config, health)` | Same |
| `maybeSpawnNote` / `generatePitches` | `maybeSpawnWord` / **`generateWords(weakKeys)`** |

**`generateWords` is where the two modes join.** It biases word selection
toward the child's weakest keys, taken from their own drill statistics. A child
who keeps missing `t` and `y` gets words carrying them.

---

## 5. Storage — session summaries, not keystrokes

A drill produces hundreds of keystrokes a minute. Logging each one as an event
would be pointless volume for no analytical gain.

Instead, **one appended record per completed session**, carrying its own
per-key rollup — append-only and date-sharded, matching quiz attempts and log
entries so a parent's reassignment (R6.5) moves a whole sitting together:

`data/users/{userId}/apps/school/typing/{YYYY-MM-DD}.yml`

```yaml
- id: typ_4b9c21
  at: '2026-07-21T17:02:44.108Z'
  mode: drill                 # drill | arcade
  lessonId: home-row-1        # null in arcade
  durationMs: 184000
  wpm: 14.2
  accuracy: 93.1
  keys:                       # per-key tallies for THIS session only
    a: { hits: 41, misses: 2 }
    t: { hits: 18, misses: 9 }
  attributedTo: kckern
```

**Weak keys are derived by folding these records, never stored as a separate
figure.** Same principle as quiz results: the log is the source of truth, so
reassignment automatically carries the statistics with it, and a scoring change
can be recomputed from history instead of losing it.

Guests do not record. As with attempts, log entries and writing, no identity
means no attribution — a guest may play arcade freely, and nothing is written.

---

## 6. A hardware keyboard is required, and must be said out loud

Touch typing on an on-screen keyboard is not touch typing. The Portal is a
touch panel; this mode is meaningless without the Bluetooth keyboard paired.

The tutor **detects whether real keystrokes are arriving** and, if the child is
tapping the soft keyboard, says so plainly and points at the Bluetooth keyboard
rather than silently recording a nonsense WPM. A tutor that scores soft-keyboard
tapping as touch typing is actively teaching the wrong thing.

The Portal's physical volume keys are claimed by `portalKeys` (`portal.yml`) —
they are not text input and are unaffected.

---

## 7. Config

Extends `data/household/config/school.yml`:

```yaml
typing:
  # Weak-key targeting: how much arcade word choice is biased toward weak keys.
  # 0 = ignore weakness (pure random), 1 = only weak keys. 0.6 leans hard
  # without becoming a punishment round.
  weak_key_bias: 0.6
  # A key counts as "weak" below this accuracy, once it has enough samples.
  weak_key_accuracy_threshold: 85
  weak_key_min_samples: 20
  # Touch typing is trained by continuing through errors, not correcting them.
  allow_backspace: false
  arcade:
    fall_duration_ms: 9000
    health: 20
```

---

## 8. File structure

Mirrors `PianoSpaceInvaders/`'s split, which is the reason that module is
testable at all: a pure engine, a hook that drives it, a thin view.

### Frontend — `frontend/src/modules/School/typing/`

| Path | Responsibility |
|---|---|
| `typingEngine.js` | **Pure.** Keystroke processing, WPM/accuracy math, per-key tallies. No React, no clock — time is passed in |
| `typingEngine.test.js` | Unit tests against the pure engine |
| `keyFingerMap.js` | Static key → finger/hand map for the guidance display |
| `weakKeys.js` | **Pure.** Folds session records into weak-key ranking; used by both the drill report and arcade word generation |
| `arcadeEngine.js` | **Pure.** Spawn/fall/collision/health/scoring, modelled on `spaceInvadersEngine.js` |
| `arcadeEngine.test.js` | Unit tests |
| `useTypingDrill.js` | Hook: drives a drill, owns state, submits the session |
| `useTypingArcade.js` | Hook: game loop |
| `TypingTutor.jsx` | Mode switch + lesson list |
| `DrillView.jsx` | Target line, caret, keyboard map, live WPM/accuracy |
| `ArcadeView.jsx` | Falling words, health meter, score |
| `KeyboardMap.jsx` | On-screen layout with next-key and finger highlight |

**Every rule that decides something lives in a pure module** (`typingEngine`,
`weakKeys`, `arcadeEngine`) so it can be tested without a DOM or a game loop.
The Piano engine's 548 lines of pure functions with a matching test file is
precisely why that module's behaviour is verifiable; this follows it.

### Backend

| Path | Responsibility |
|---|---|
| `2_domains/school/typingLessonValidation.mjs` | Pure lesson-file validation, mirroring `questionBankValidation.mjs` |
| `3_applications/school/TypingService.mjs` | List/get lessons, append a session, fold weak keys |
| `1_adapters/persistence/yaml/YamlSchoolDatastore.mjs` | **Modified**: typing session append/read |
| `4_api/v1/routers/school.mjs` | **Modified**: routes below |

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/typing/lessons` | List, ordered |
| `GET` | `/typing/lessons/:id` | One |
| `POST` | `/users/:userId/typing` | Append a completed session |
| `GET` | `/users/:userId/typing/stats` | Folded stats incl. weak-key ranking |

`SchoolApp.jsx` gains Typing alongside Courses, Banks and Writing.

---

## 9. Deliberately not doing

- **No lesson gating.** Lessons are ordered and suggested, not locked.
  Sequential courses already carry a mastery lock with a documented dead-end
  risk; a second locked ladder on a skill built by repetition would be a trap
  with no upside. A child may practise any lesson.
- No typing-speed leaderboard between siblings. Comparative speed is
  discouraging for the slower child, and this device already has a coin economy
  for motivation.
- No spell check or autocorrect anywhere — the child types exactly what is
  asked.
- No custom key remapping, no alternative layouts (Dvorak/Colemak).
- Coin rewards for typing are deferred to the economy sub-project rather than
  being wired in ad hoc here.
