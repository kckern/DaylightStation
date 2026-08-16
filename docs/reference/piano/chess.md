# Piano Chess — the chrome

The board is the game. The **chrome** is everything around it: the rails, the read-outs, the
prompt, the settings. This document is the chrome's reason for existing, written as the questions
a player asks out loud while playing.

Mechanics — the engine, the config pair, the rung ladder, narrowing, the gesture vocabulary, the
game record — live in [piano-games.md](piano-games.md#piano-chess). This document does not repeat
them. It covers only what the screen shows and why.

## The rule the chrome is held to

Every element answers exactly one question, and a player can name the question. An element that
answers no question is removed; two elements answering the same question are merged. The failure
this rule exists to prevent is documented: a live session completed **zero moves in eight minutes**
while the player spelled correct chords, because nothing on screen said what had been heard, what
was in hand, or where it could go. Decoration is not the risk. Silence is.

## Who plays

| Player | Reads | Addresses squares by |
|--------|-------|----------------------|
| The reader | Notation, both clefs | Notes on a staff — a rank is a bass-clef pitch, a file a treble-clef pitch |
| The speller | Chord symbols | Chord quality and root — the rank is `m7`, the file is `A` |
| The operator | — | Not playing; sets the rung, the cue loudness, and checks whose game it is |

The reader and the speller are the same game with a different addressing vocabulary. The chrome is
identical for both; only the rim labels change.

## The stories

### Before touching a key

1. **Whose game is this?** A kiosk has one screen and several children. The player needs to see
   that the game belongs to them, and that a sibling walking up cannot take it over mid-game.
2. **Whose turn, and which colour am I?** Asked once a move and answered without reading the
   position.
3. **How strong is the opponent right now?** The rung is a promise about how the game will feel;
   it must be visible without opening anything.
4. **Is my piano connected?** A dead cable and a wrong chord look identical from the player's
   chair. This is the first question when nothing happens.
5. **What chord names each square?** The board's rim carries the vocabulary. The player reads a
   root off one edge and a quality off the other.
6. **Did the map move?** When the chord map re-deals between turns, the player must be told once —
   loudly for a beat, then quietly — or they will spell yesterday's square.

### While spelling a chord

7. **Did it hear the notes I am holding?** Answered by the keys themselves lighting, independent of
   whether those notes mean anything.
8. **What chord am I playing?** By name, spelled correctly for the key — `G♯ minor`, not a pile of
   letters that stack in no triad.
9. **What did I just play, in notation?** The reader cannot check a chord symbol against their
   hands. They check a staff. This is the same question as 8 in the other vocabulary, and both
   players benefit from seeing both.
10. **Is this chord going anywhere?** Three answers, and the player must be able to tell them
    apart: still too few notes; a real chord that no square carries; a chord that names a square.
11. **Which square does it name?** The named square lights. Nothing is committed while any key is
    down — the player is looking, not moving. The complete press is resolved only after release,
    so a triad played on the way to a seventh is never mistaken for the intended address.

### Picking a piece up

12. **How do I actually pick something up?** The double-play rule is not discoverable. It is
    stated in words, on screen, at the moment it applies — and because that instruction carries a
    deadline, the deadline is drawn with it: a rule beneath the sentence drains for exactly as long
    as the repeat will be heard. Without it the double is the one interaction that fails
    invisibly, since a player who repeats a chord too late gets silence and no way to tell whether
    they were slow or misheard. The window is deliberately slack — two and a half seconds, enough
    to read the sentence asking for the repeat and then play it, because the logged failures were
    players pausing to read rather than players fumbling a fast repeat.
13. **Did I pick it up?** The single most expensive silence in the game's history. The square whose
    piece is in the air is marked unmistakably.
14. **What am I holding right now?** A standing question, not a momentary one. A player hunting for
    a destination spends a long time plucking through chords, experimenting, losing their place —
    and a mark on a distant square is not enough to keep "I am mid-move, holding my knight" in a
    child's head. The state rail carries a space reserved for this and used for nothing else: the
    piece itself, drawn large, with the square it came from. When nothing is held the space says
    so, so its emptiness is also an answer. Directly beneath it, in the same block, the way to put
    the piece back is spelled out — the escape must be legible in the exact place the player is
    looking when they feel stuck, not inferred from a gesture nobody taught them.
15. **Where can it go?** Every reachable square is marked.
16. **What chord gets it there?** Marked squares carry the chord that addresses them. Without this
    the player must read a root off one rim, a quality off the other, and intersect them mentally
    while holding a piece — which is precisely the load that produced zero moves.
17. **What happens if I play this one?** A ghost of the held piece previews the landing, so a
    capture is visible before it is committed.

### When nothing happens

18. **Why was that refused?** A refusal names its cause in a sentence and flashes the square. It
    never reveals a legal move — that would make refusal cheaper than asking.
19. **Why was that ignored?** Different from refused, and more dangerous: exploring an unreachable
    square while holding a piece is *deliberately* silent, so the player must be able to see that
    the game heard them and simply had nowhere to put the piece. The read-out carries this.

### After a move

20. **What did I just do?** The last move stays outlined until the next one.
21. **Am I in check?** The only alarm on the board, and the only use of red.
22. **What has been taken?** Captured material, both sides, at a glance.

### Asking for help

23. **Which of my pieces can move at all?** Asked with a gesture at the keys, never volunteered.
24. **What is the best move?** The same, one gesture further. Both are counted.

### At the end

25. **How did that go?** Facts, not a score: moves played, hints asked for, best moves asked for.
26. **Again.** One target.

### The operator's stories

27. **Change the difficulty, the cue loudness, or the addressing vocabulary** without leaving the
    game, in discrete tap targets, saved to the player's own layer.
28. **Get out.** The way back to the games picker is always on screen.

## Where the stories are answered

The screen is three zones plus the instrument.

**The board is horizontally centred on the canvas, unconditionally.** It is the thing the player
looks at, and a board that drifts left because one rail grew a line of text reads as broken. The two
rails therefore claim equal width and the board takes what is left between them, so centring is a
property of the layout rather than something that happens to hold at the current content length. A
rail's content fits the width it is given — it never sets it. Neither rail may push the board off
centre by growing, and neither may leave it off centre by being empty.

**The state rail (left)** answers the questions about *this move*: whose game, whose turn, the rung,
the prompt that states the next gesture in words, what is hovered, what is in hand and from which
square, how many squares it can reach, and why the last input was refused or ignored. It carries the
way out and the settings target. It is the chrome's answer to "what is the game currently thinking",
and it is the first place to look when nothing happens.

**The board (centre)** answers the questions about *the position*, through four channels that never
compete: light for what the hands are doing now, outline for where the player is in the move, marks
for what a held piece can do, colour for alarm only. Its rim carries the addressing vocabulary.
Light narrows only across squares actionable at that moment: movable pieces before pick-up and legal
destinations afterward. Empty, enemy, and unreachable squares do not join the partial-chord dance.

**The chord rail (right)** answers the questions about *what is being played*: the chord's name, and
the same chord as notation on a grand staff. It is a mirror of the player's hands, in both
vocabularies at once, and it is where the reader checks themselves. No circle of fifths — this rail
reports, it does not teach theory.

**The instrument (bottom)** is the keyboard, and only the keyboard: which keys are down. It answers
question 7 and nothing else.

### The move log is not chrome

A move history answers no question a player asks during a game. It was removed. What was taken is
kept, because material is a question children genuinely ask; the notation of how it happened is not.

### Why the read-outs moved off the bottom

The bottom strip formerly carried two elements answering one question. A plaque named the chord, and
beside it a read-out re-printed the same chord as a symbol plus the game's verdict on it. Idle, the
read-out said "Listening", which is not an answer to anything. The two halves belong in different
places: naming what is played is a chord-rail story (8, 9), and the verdict — heard it, cannot place
it, refused it, ignored it — is a state-rail story (10, 18, 19). Splitting them puts each answer
beside the other answers of its kind, and leaves the instrument zone showing the instrument.

## The two vocabularies

`addressing` picks which skill the board asks for. It is a household default with the usual
per-user override, and the in-game settings panel offers it as a pair of tap targets.

| `addressing` | A square is | Notes to play |
|--------------|-------------|---------------|
| `chords` | file = root, rank = quality | Three, spelled as a chord |
| `staff` | file = a note on the treble staff, rank = a note on the bass staff | Two — one on each staff, left hand picks the row, right hand the column |

Under `staff` the rim stops printing text and draws the note itself, on the staff it is read from.
The octave matters, which is the whole point of reading: C4 and C5 are different lines. Everything
else in the game is unchanged — narrowing, hover, pick-up, badges, the record — because it is a
different vocabulary for the same 64 squares, not a different game.

One consequence is worth stating because it is not obvious. A square in this vocabulary can *be* an
octave: the bass and treble staves both carry a C, so C2-with-C4 is a legitimate square. The square
wins, and the escape stays reachable because a player escapes with two notes in one hand — both on
the same staff, which is never an address.

Narrowing is better in this vocabulary than in the other: one note lights a whole rank or a whole
file, so the player watches the row and the column meet.

## The game history

Every game played on this piano is archived under
`data/household/history/gaming/pianochess/YYYY-MM-DD/`, where `YYYY-MM-DD` is the
piano's local calendar day. One file is written per game, named
`{user}_level{opponentLevel}_{duration}_{moveCount}ply_{result}_{outcome}_{timestamp}-{uuid}.yml`.
The filename makes a directory listing useful without opening YAML; `levelunknown` is
used honestly for an old/incomplete game where effective-opponent telemetry was never resolved.
An abandoned game is named `quit_quit`; its YAML retains `ended_by: left` as the event detail.
This is separate from the player's own scorecard (`apps/chess/games/`), which only exists for games
that finished, and it answers a different question: *how is this child actually doing, over months?*

Three properties make it worth keeping.

**It records unfinished games.** Walking away is data — a position a child gave up on says more
about where they are than one they saw through. `completed: false` with `ended_by: left` is the
interesting record, not a defective one. Because a kiosk game usually ends by the tab closing or
the screen sleeping, and neither runs any in-app teardown, the archive is written on `pagehide` via
a beacon; leaving inside the app writes it the ordinary way.

**It is replayable.** The starting position plus every move in SAN and from/to is a complete game,
so the engine can read it back later and say where it went wrong. Nothing downstream — blunder
analysis, accuracy, progress curves — is possible without the moves, and they cannot be recovered
after the fact.

**It keeps the music.** Every move stores the two addresses that performed it, alongside the
vocabulary they are in, because `C/B` and `Cm` mean entirely different things. Which chords a child
can spell under time pressure, or which notes they can read, is what the piano is actually
teaching, and it is invisible in a PGN.

Guests are archived too, with a null player: the history is about what happened on the instrument.

## Motion, and what it costs

The kiosk runs this in a WebView on a 2018 tablet, and that device sets the rules:

- **Continuous animation is `transform` and `opacity` only.** Paint properties (`box-shadow`,
  `background-position`, `filter`) may only ever appear as one-shot bursts under ~700ms on a single
  square.
- **No blur anywhere** — no `backdrop-filter`, no animated `filter`.
- **Every animation gets a `prefers-reduced-motion` equivalent.** Where the animation carries
  *information* rather than delight — the toppled king says which side lost — the static form keeps
  the end state instead of removing it.

Three rules bought back the reported jank, and it is worth knowing why each was a problem:

**One move generation per position, not four per keystroke.** `playableSources` and
`destinationsFor` each build a `new Chess(fen)` and run a full verbose movegen. Four call sites
wanted one or the other, three unmemoized — so they ran on every render, and renders happen on every
MIDI note on *and* off. A held chord is three to five of those inside 100ms. There is now a single
`legalDestinations` memo keyed on the FEN and everything derives from it.

**Stable identities for the board's props.** `ChessBoard` is memoized and `Square` now is too, but a
fresh `[]` or `{}` per render defeats a memo exactly as thoroughly as changed data would — which
cost 64 square subtrees and ~32 images per note event.

**Candidate squares snap.** Transitioning `box-shadow` rasterized every lit square every frame for
120ms, then again on release.

### The two actors move differently

Your move slides in 180ms; the opponent's takes 420ms and lands no sooner than **1200ms** after
yours. That floor counts the engine's own thinking, so a slow rung does not pay it twice. A reply
that arrives while the player is still reading the rail they just triggered is a reply they never
see — they look up at a board that changed by itself, which was the most-reported confusion with
this game. For the same reason a captured piece now fades out instead of vanishing on the frame its
taker renders, and the last-move mark is a solid 3px outline in a colour reserved for the opponent
rather than a 2px dash at 42% opacity that nothing could read across a room.

## The clock

FIDE requires a clock for competitive play (Laws of Chess, Article 6). A child learning to spell
chords does not need a losing condition to benefit from seeing where their time went, so the clock
here is a display first and a rule second.

| Mode | What it does |
|------|--------------|
| `up` *(default)* | Counts time spent per side. Nothing is ever forfeited. |
| `down` | Counts remaining time against a control, and marks a side that runs out. |
| `off` | No clock. |

Configured under `timing:` in the household chess config:

```yaml
timing:
  mode: up          # up | down | off
  initial_ms: 600000
  increment_ms: 0
```

**Nothing ends a game on time.** A flagged clock in `down` mode is reported so the board can say so,
and that is all. Enforcing a loss on time was deliberately not built — it was not asked for, and it
would mean routing a synthetic result through the game-over, archive and promotion paths for a
feature nobody wanted.

The clock is **derived, not ticked**. Every move records when it landed, so both sides' times are a
pure function of the move list plus "what time is it now". That is why it cannot drift out of step
with the board, cannot be left running on the wrong side after a takeback, and survives a remount
with no special handling. A finished game freezes, so the board agrees with what was archived.

Two consequences worth knowing. A move with no timestamp is reported as *untimed* rather than as
zero — games archived before the clock existed must not appear to have been played instantly. And a
taken-back move carries no think time, because there is no played line to measure it against; the
time it consumed is still in `duration_ms`, which is wall clock and counts everything.

### What the clock is for

Time on its own is trivia. The reason to record it is that time and move quality are related, and
the relationship is legible to a child in a way that centipawns are not: *you blunder on the moves
you play instantly.* That is a habit a nine-year-old can change.

`chess-review.cli.mjs` reports it under **ON THE CLOCK** — total and median think, the longest
think, and a split of the player's moves at their **own median** into quick and slow, with the ACPL
and error rate of each. The median rather than a fixed number of seconds: "fast" has to mean fast
*for this child in this game*, or a fixed cutoff would call every move fast for a quick player and
report that as a finding. Below four moves either side of the split, nothing is claimed at all.

## Reviewing a game afterwards

The archive says which rung a child faced and whether they won. It cannot say how well they
played, and those are different questions: "lost to Level 0" covers both a child who was outplayed
from move one and a child who was winning until one move. `cli/chess-review.cli.mjs` answers the
second one.

```bash
node cli/chess-review.cli.mjs --user <child> --date 2026-08-15   # coaching report
node cli/chess-review.cli.mjs --user <child> --latest --brief    # without the move table
node cli/chess-review.cli.mjs --user <child> --trend             # form over every game
node cli/chess-review.cli.mjs --user <child> --latest --pgn      # annotated PGN
node cli/chess-review.cli.mjs --user <child> --all --drills      # mistakes to re-solve
```

The report has six parts, each answering a question a move list cannot:

| Section | Question |
|---------|----------|
| Move table | What did each move cost, and what did the engine want? |
| The moment it turned | Which single move decided it — with the board drawn |
| By phase | Is the weakness in the opening, the middlegame, or the endgame? |
| On the clock | Where the time went, and whether rushing is costing anything |
| What to work on | Which mistakes recur, named as motifs a child can act on |
| Per-side summary | ACPL, blunder counts, engine-match rate, for both players |
| Rung fit | Is this opponent the right opponent? |

`--trend` collapses each game to one row and reports form across months, because one game's ACPL is
mostly noise — a single sharp position swings it. `--pgn` writes standard annotated PGN with NAGs,
so a game opens in Lichess or any board GUI. `--drills` turns the child's own mistakes into
positions to solve again, which is the part of coaching that actually changes anything.

Four decisions matter for reading the numbers:

**The reviewing engine is never handicapped.** It runs at full skill regardless of the rung being
reviewed, because a review is only comparable across games if the yardstick never moves. It is a
separate worker from the one that plays (`stockfishAnalysisWorker.mjs`, not `stockfishWorker.mjs`)
— the play worker's whole contract is one throttled bestmove out, with the evaluation discarded,
and review needs the opposite.

**Both sides get measured.** The opponent's numbers come out of the same pass as the child's, which
is the only honest way to ask whether a rung is placed right. A rung that is nominally the bottom of
the ladder but posts a better average than the child is the answer to "why does this feel so hard",
and no amount of reading the config would have revealed it.

**The opening is excluded from ACPL.** Book moves are free accuracy, and they flatter the weaker
player most, because they are a larger share of that player's few good moves.

**The critical moment is not simply the biggest mistake.** A blunder made while already lost changed
nothing, and pointing at it teaches a child the game was decided after it was over. The moment
reported is the largest loss that actually surrendered a position worth having.

Search runs to a fixed **depth**, not a fixed movetime, so two runs of the same game agree. Depth 16
is the default and takes a minute or two per game; higher is slower and more accurate.

## Calibrating the ladder

`cli/chess-calibrate.cli.mjs` measures how strong the rungs actually are, rather than what their
labels claim. Every candidate answers the same positions — sampled from games the children really
played — and is scored against a full-strength reference, so rungs, the homegrown teaching
opponent, and the children themselves all land on one comparable scale.

```bash
node cli/chess-calibrate.cli.mjs --player <child>
node cli/chess-calibrate.cli.mjs --skills 0,4,8,12,16,20 --homegrown
```

It reports candidates within 25cp of each other as a single band. That grouping is the point: two
rungs that cannot be told apart are one rung wearing two faces, and a ladder built from them
promises a child progress it cannot deliver.

## The opponent ladder

Twenty-one characters, one per engine skill level — the weakest the engine can be at 0, unbeatable
at 20. They are met in order and each one has to be earned, because "Skill Level 7" is not
something a child wants to defeat.

### What the rungs actually measure

Measured with `cli/chess-calibrate.cli.mjs` over positions from the children's own games. Lower
ACPL is stronger; the children's own numbers are on the same scale.

| Candidate | ACPL |
|-----------|------|
| Stockfish, **every** skill level 0-20 @400ms | **32-47 — one band** |
| homegrown depth 2, blunder 0.1 | 83 |
| homegrown depth 2, blunder 0.2 | 101 |
| **the child this was built for, over their own games** | **111** |
| homegrown depth 2, blunder 0.35 | 134 |
| homegrown depth 2, blunder 0.5 | 146 |
| homegrown depth 1, any blunder rate | 185-243 |

**Read the first row as a limit of the measurement, not as a fact about Stockfish.** Skill 20 is
obviously not equal to skill 0. What the run shows is that a depth-12 reference cannot separate them
on quiet positions out of children's games: every candidate plays at or above the reference's own
standard, so they all score near zero loss and collapse together. Separating the Stockfish tier
needs a much deeper reference; that calibration has not been done.

What the runs *do* establish, because these gaps are far larger than any noise or ceiling effect:

**Every Stockfish rung is out of a learning child's reach, including level 0.** The child scores 111;
the entire Stockfish range scores 32-79 across two independent runs on different position sets. The
gap is not marginal and it does not depend on which skill level is chosen. Level 0's label promises
a beginner and delivers something well past one.

**The floor is structural.** `skill` is clamped to 0 and the `elo` path cannot go below 1320, so no
configuration produces anything weaker. Node-limiting does not help either: `go nodes 1` at skill 0
measured *stronger* than the 400ms search, not weaker. Stockfish has no child setting.

**The homegrown opponent is the child tier, and it has real gradations.** `opponent.mjs` spans
74-243 ACPL — the band the children are actually in, which Stockfish cannot reach from above. Its
`blunder_rate` is a working dial at depth 2 (146 → 134 → 101 → 83 → 74) but not at depth 1, where
the 1-ply search is already so weak that the second-best move is no worse than the best.

### The two tiers, as built

`DEFAULT_LEVEL_RUNGS` in `shared/gaming/chess/ladder.mjs` now maps each level to an engine:

| Levels | Engine | Graded by |
|--------|--------|-----------|
| 0-8 | homegrown `opponent.mjs` | search depth, then blunder rate |
| 9-20 | Stockfish | skill, with movetime rising alongside |

The seam is where they measured equal: depth 2 with no blundering (74) sits alongside Stockfish
skill 0 (79). The Stockfish half's internal spacing is **provisional** — the calibration reference
could not separate skill 0 from skill 20, so those rungs are ordered by construction, not by
measurement.

The table is data: a household can re-space the whole ladder from YAML under `ladder.levels` without
a code change, which is the point of measuring in the first place. A short override fills the rest
from the default rather than leaving a level unreachable.

A rung now travels with its `engine`, `depth` and `blunder_rate` into the archive. Without that, a
reviewed game could not say whether "level 3" meant the teaching engine or Stockfish — and since
the mapping changes as the ladder is re-spaced, a bare level number is not a strength.

### Hints and analysis are not the opponent

`POST /api/v1/chess/analyze` answers "what is the best move here" at **full strength, always**,
through a second engine instance that is never handicapped.

This used to be `POST /move` with a hardcoded `rung: 'ruthless'` — the hint borrowed the opponent
pathway. That had to go the moment the lower rungs stopped being Stockfish: asking the opponent
engine for the best move would have handed a child whatever a deliberately-weak teaching engine
liked. Opposition and analysis are different questions and now have different doors.

The same separation runs all the way down: `stockfishWorker.mjs` plays (one throttled bestmove out,
evaluation discarded) and `stockfishAnalysisWorker.mjs` analyses (full skill, the score *is* the
answer). Weakening the opponent can never weaken a hint, a review, or a calibration run.

One caution on the numbers: ACPL is only comparable *within* one calibration run, since the absolute
value depends on how sharp the sampled positions happened to be. Skill 0 measured 34 in one run and
79 in another on a different position set.

Three rules, and each exists to protect something:

- **No demotion.** Once a character is beaten they stay beaten. A ladder that can take a rung back
  turns a bad afternoon into lost ground, and the point is to make a child want to sit down again.
- **No skipping ahead.** Already-beaten characters can be replayed — that is practice — but only
  the next one up can be promoted against. This is enforced where the engine strength is chosen,
  not in the picker, because a picker can be bypassed with a crafted request.
- **Help-heavy games do not count.** A game where the engine was asked for the best move was partly
  played by the engine; promoting on it would certify a skill nobody has. One orienting hint is
  allowed. Every game is still remembered — it simply earns nothing.

Promotion is by recent form: win five of your last seven counted games. A lifetime tally would let
"has beaten them nine times since March" stand in for how the child is playing today.

| What | Where |
|------|-------|
| The policy — window, wins required, help allowances, the roster | Household `config/chess.yml` under `ladder:` |
| A player's progress — how far they have climbed, recent results | Per-user `apps/chess/ladder.yml` |

The server owns the writes. If the kiosk decided its own promotions, a reloaded tab or a closed lid
mid-write would lose a rung a child had earned — the one piece of state here they would genuinely
mind losing. A guest climbs nothing and always faces the bottom of the roster, and the screen says
so rather than showing a progress bar that resets on reload.

The roster is data. Each character is a name, a face, and a colour. The face defaults to an
identicon generated from the name — the same generator the card game uses, so a name wears one face
across this house's games — and the colour retints the board's dark squares, so arriving at a new
character looks like arriving somewhere new. Both are derived from the level unless the roster says
otherwise, which means twenty-one characters exist without twenty-one entries being maintained.

Replacing the roster in YAML re-themes the whole ladder without touching the promotion arithmetic,
which is how a Pokémon roster gets in: weakest creature at 0, legendaries at the top, artwork and
board colour per entry.

The character is present while you play. The chord rail shows their face, their name, and what they
are doing — thinking, what they last played, what they just took off you, and how the game ended.
Every one of those is read off real game state; none of it is written to fill the line, because a
status that is sometimes theatre is a status a child stops reading.

## Learning it, and looking again

**The first game teaches itself.** A four-step walkthrough — find a square, arm it, lift the piece,
land it — keyed to states the selection machine really reaches, so a player who does something out
of order is never stranded on a step they have passed. Shown once per player, recorded as
`seen_intro` in the user config layer: a coach-mark that returns every session is one a child learns
to ignore.

**"Show that again" is a fifth gesture.** Five adjacent semitones, safe for the same reason three
and four are — no square's chord voices an unbroken semitone run, so it cannot collide with move
input. It rewinds to before the last exchange and plays it forward at half speed. Never charged as
help: it shows what already happened in full view.

The rewound position is replayed from the start of the game rather than read from a stored list of
per-ply positions. A stored list is one more thing that can fall out of step with the move list
after a takeback; replaying cannot.

## Not yet built

- **Calibrate the Stockfish half against a deeper reference.** Levels 9-20 are currently spaced by
  construction, not by measurement — a depth-12 reference could not separate skill 0 from skill 20.
  Until that is re-run, the top of the ladder may still be flatter than it looks.
- **Material odds as a second axis.** Worth adding if more than the current nine child rungs are
  wanted. It is a real strength dial, it composes with either engine, and it is legible to a child
  in a way that a search depth is not: "Caterpie is playing without his queen." It needs the game
  to start from a non-standard `initial_fen` and the board to say why.
- **Inversions as distinct squares.** Graded by difficulty so a beginner is never addressed in
  slash chords.
- **The opponent ladder** — 21 personas over the engine's skill levels, promotion by recent form,
  per-user progress. Captured in `docs/_wip/plans/2026-08-12-piano-chess-opponent-ladder.md`.
