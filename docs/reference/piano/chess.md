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
11. **Which square does it name?** The named square lights. Nothing is committed — the player is
    looking, not moving.

### Picking a piece up

12. **How do I actually pick something up?** The double-play rule is not discoverable. It is
    stated in words, on screen, at the moment it applies.
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

## The opponent ladder

Twenty-one characters, one per engine skill level — a blundering buffoon at 0, unbeatable at 20.
They are met in order and each one has to be earned, because "Skill Level 7" is not something a
child wants to defeat.

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

## Not yet built

- **Inversions as distinct squares.** Graded by difficulty so a beginner is never addressed in
  slash chords.
- **The opponent ladder** — 21 personas over the engine's skill levels, promotion by recent form,
  per-user progress. Captured in `docs/_wip/plans/2026-08-12-piano-chess-opponent-ladder.md`.
