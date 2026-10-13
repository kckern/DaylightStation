# FHE Charades design

Status: design for user review; implementation has not started.

## Agreed experience

Launch a focused Charades game from the FHE menu. Choose the participating
household members using remote controls. Play three rounds, with each person
performing once per round in independently shuffled order: exactly three turns
per participant. Each turn has one clue and 60 seconds of guessing time.
Round count, clues per turn, duration, presentation assignments, and music are
configuration, not application constants.

Tonight uses casual mode: no scores, ranking, winners, correctness questions,
teams, verification steps, or competitive language. Keep the existing team,
outcome, and winner infrastructure usable by competitive configurations.

## Architecture and existing components

Extend the focused Charades presenter and the existing activity-party rule
module, which already owns authoritative phases, deadlines, and performer
rotation. A separate FHE app would duplicate session infrastructure; adapting
the full Activity Party presentation would add drawing and adjudication UI
unnecessary for this experience.

PartyGamesApp remains the environment shell. Wire an explicit definition launch
from the FHE menu through screen-framework and into the catalog selection flow.
The reducer already understands requestedGame, but the current app bootstrap
does not pass a requested selection. Support the configured definition identity
so opening FHE selects the intended configuration, including when multiple
Charades definitions exist.

Use existing household identities and participant setup. Adapt FamilySelector
for an embedded, controlled wheel with supplied members, committed winner,
automatic spin, and completion callback. Preserve its standalone use. Its
current autoSpin argument is unused and it installs a global keyboard listener;
embedded mode must use the screen-framework input owner instead.

Store each round's seeded permutation in authoritative session state. The wheel
animates the next committed performer; it does not decide whose turn counts.
Resuming, refreshing, duplicate button presses, or animation completion must
not consume extra turns or reroll a performer or clue.

## Turn flow and remote input

1. Spin the wheel automatically to announce the selected performer.
2. Show the encoded clue indefinitely. The performer studies it through the
   physical red decoder card. No guessing timer or music runs in this phase.
3. A fresh remote OK/Enter press means Go: hide the clue, start the authoritative
   deadline, and start the guessing music.
4. Show the timer while the performer acts. OK may finish early, without
   asserting that the clue was guessed correctly. Deadline expiry also ends
   the turn automatically.
5. Stop music and reveal the answer, including the unencoded image for image
   clues. OK continues to the next scheduled turn.
6. After the final reveal, finish with a neutral completion screen and remote
   options to return to FHE or play again.

Use screen-framework semantic actions and focus ownership throughout setup,
play, reveal, and results. Ignore key repeats and prevent a single held button
from crossing multiple phases. Back uses the established shell dismissal path.
No touchscreen, phone, buzzer, or correctness confirmation is required.

For configurable clues_per_turn greater than one, the timer is a per-turn
budget: ending a clue early reveals it, then OK shows the next encoded clue if
the configured count and time budget allow. Reading remains untimed, with the
remaining guessing budget paused until Go. Timer expiry ends the turn. Tonight
uses one clue, so no intermediate clue loop appears.

## Content bank and selection

Seed content/games/charades/choices.yml under the configured data root. Use a
versioned list of entries with stable id, text, and optional relative image path.
The content loader validates this authored bank and compiles entries to the
rule module's challenge format; UI code does not carry a fallback word bank.
Resolve image paths through the existing authorized media-serving boundary.

The five existing SVGs depict frog, elephant, duck, crab, and monkey. Add an
original rabbit SVG with transparent background and simple recognizable line
art. Preserve the existing source files and their attribution comments.

Illustrated entries provide the image pool. Seed a separate set of 30 text-only
entries so word turns do not use up or reveal the six image clues needed for
User_4 and User_5. Their identities and image presentation assignments live in
household configuration. All other selected people use the text-only pool.

Proposed text seed:

- Brushing your teeth
- Flying a kite
- Riding a bike
- Swimming
- Making pizza
- Building a snowman
- Walking a dog
- Playing the piano
- Reading a book
- Washing dishes
- Sweeping the floor
- Blowing up a balloon
- Eating spaghetti
- Peeling a banana
- Tying your shoes
- Going fishing
- Throwing a ball
- Jumping rope
- Climbing a ladder
- Driving a car
- Baking cookies
- Taking a picture
- Digging a hole
- Painting a wall
- Carrying a heavy box
- Opening a present
- Putting on a coat
- Flying an airplane
- Playing a drum
- Looking through binoculars

Shuffle each eligible pool deterministically; consume without repeats across
participants until exhausted, then reshuffle, avoiding an immediate repeat
when the pool has more than one entry. Six illustrated entries provide six
distinct image turns for tonight. Pin the compiled bank to the session so data
edits cannot change an in-progress game's clues.

## Decoder presentation

Reuse the existing segmented word decoder. Put reusable decoder presentation
in Gaming's platform UI so Charades does not depend on Activity Party UI.

Refine ImageDecoderDisplay using the six actual assets: cyan subject lines and
red circles/bubbles on a background chosen for contrast through the physical
red filter. Tune line thickness, noise density, layering, and background as a
single visual design. Its current dark background and masking are starting
points, not proof that the filter will work. Do not reveal answer labels or
plain image previews during the secret stage. A failed image shows a retry
state rather than silently exposing a text clue or consuming the turn.

Browser screenshots and simulated red filtering check layout and color
behavior; actual concealment and readability require the physical card on the
target display. Record that validation separately from automated checks.

## Timer, music, and configuration

Move the reusable Fitness Timer into Gaming's primitive layer and retain a
compatible Fitness import/re-export. Remove its dependency on Fitness-specific
buttons/styles. Add a controlled deadline-driven mode for authoritative game
time; preserve existing Fitness behavior. Resuming play must display remaining
time rather than start another full minute.

The authored configuration expresses rounds: 3, clues_per_turn: 1,
timer_ms: 60000, competition/scoring/outcome-confirmation disabled, seeded
per-round selection, image presentation by participant, and a guessing-music
content reference with random selection. Store the user-provided Plex source
in household data only; no instance-specific identifier belongs in source
code or generic documentation.

Use the existing media resolver/player and the Gaming environment audio port
to select a random playable child of the configured source for each turn.
Prefetch metadata before Go when practical. Music runs only while guessing;
stop on early finish, expiry, exit, and unmount. Cancel stale asynchronous
loads so late resolution cannot start music after a turn ends. If a track ends
before the timer, select another from the configured source. Music failure is
visible and logged but does not strand the game or stop the timer.

## Casual rules and future competition

Casual finish/expiry transitions directly to neutral reveal/completion without
manufacturing a correct/incorrect/pass outcome or awarding points. Casual
results omit scores and winner/ranking semantics. Presenters, shell results,
and optional companions respect the projected competition configuration.

Keep existing competitive definitions' behavior and defaults unchanged. Teams,
score changes, outcome proposals, verification, and winner results remain
available through their existing contracts; this iteration does not add a new
competitive setup experience.

## Validation and observability

- Rule tests prove three seeded permutations give each selected person exactly
  three turns, survive resume, and cannot double-advance on repeated commands.
- Content tests validate unique IDs, image references, pool eligibility,
  deterministic selection, pool exhaustion, six distinct image turns, and a
  configurable clue count and time budget.
- Casual mode tests prove no correctness gate, score mutation, ranking, or
  winner presentation; existing competitive behavior remains covered.
- Timer tests check authoritative deadlines, expiry, resume, and existing
  Fitness consumers. Audio checks cover delayed resolution, source failure,
  repeated state updates, turn transitions, and exit cleanup.
- A full remote-only browser flow launches from FHE, selects participants,
  traverses every turn, tests text and picture decoder stages, waits for Go,
  verifies early finish and timeout, and returns to the menu after completion.
- Check configured Plex playback and every real SVG through the running app;
  do not treat mocked playback as proof of working media integration.
- Add structured lifecycle, phase, selection, asset-error, and music events
  without logging secret clue contents. Update Gaming reference documentation.

## Delivery boundary

Implementation includes source changes, the seeded YAML bank, the rabbit SVG,
household game configuration, and the FHE menu entry. The content/config files
are external to the repository and must be verified separately. This document
records their intended changes; it does not claim they have been applied.
