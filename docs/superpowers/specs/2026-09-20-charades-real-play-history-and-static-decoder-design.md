# Charades Real-Play History and Static Decoder Design

## Intent

Prepare FHE Charades for a real game on 2026-09-20. Only the final completed
2026-09-13 certification game counts as prior play. Its 18 clues become the
canonical starting history; all other diagnostic and test sessions are ignored
for clue selection. Future completed turns extend that history.

For today's preset, text decoder clues must remain visually fixed: no marquee,
progressive reveal, position movement, color reshuffling, flicker, or flipping.
The existing animated decoder capabilities remain available to other presets.

## Canonical Starting History

The canonical source session is
`game:4978457a-e9f0-4bee-b941-765d5daa33a6`. In played order its clue IDs are:

1. `rabbit`
2. `climbing-a-ladder`
3. `elephant`
4. `catching-a-butterfly`
5. `driving-a-car`
6. `carrying-a-heavy-box`
7. `making-pizza`
8. `blowing-out-birthday-candles`
9. `turtle`
10. `picking-apples`
11. `koala`
12. `washing-your-hair`
13. `duck`
14. `shooting-a-basketball`
15. `vacuuming-a-rug`
16. `alligator`
17. `peeling-a-banana`
18. `catching-popcorn-in-your-mouth`

The six configured participant profiles included two adults and four children.
Participant identity does not change global clue eligibility: a clue
played by anyone counts as used for the FHE preset.

## History Architecture

Add an ordered, append-only YAML ledger at
`household/gaming/history/charades.yml`. Entries are scoped by definition ID and
carry an idempotency key, clue ID, session ID, challenge index, presentation,
and timestamp. Raw Gaming snapshots and journals remain replay/audit artifacts;
they are not inferred as human play history and therefore do not need deletion.

Session creation reads the `charades:fhe` ledger and embeds the ordered clue IDs
in the journaled setup. The pure Activity Party ruleset uses that captured
history to build the deterministic challenge order. Journal replay therefore
does not depend on whatever history exists later.

Image and text are separate eligibility pools because configured participants
require one presentation or the other. Within each pool, derive the suffix of
history since the last time every eligible clue in that pool had appeared.
Shuffle unused clues first. If a session consumes the last unused clue, begin a
new shuffled cycle for the remaining turns without an immediate duplicate.
This is the only condition under which recycling is allowed.

Record a clue after `challenge.finished` commits. Writes use
`session-id:challenge-index:clue-index` as the idempotency key, so HTTP retries
cannot double-count a turn. A failed history write makes the request fail after
the authoritative command commit; retrying the same command repairs the ledger
through the duplicate-command result.

## Static Decoder Configuration

Keep `decoder.reveal: static` for an always-visible segmented clue and
`decoder.motion: false` for a fixed card position. Add
`decoder.color_animation: false` to freeze the initially assigned warm/cool
segment colors. The default remains `true`, preserving every existing animated
mode and all other presets.

When reveal is static, motion is false, and color animation is false, the
decoder engine paints once and installs no interval. The DOM must retain the
same reveal step, transform, segment classes, and segment colors over time.
Reduced-motion behavior remains unchanged.

## Data Reset

Provide a repository-owned reset command that writes exactly the 18 canonical
entries after displaying the target file and proposed clue list. It makes a
timestamped backup before replacement. The reset changes only the Charades
ledger; it does not delete deterministic session journals or snapshots.

## Verification

Unit tests cover ordered history persistence, idempotent append, per-pool cycle
exhaustion, deterministic replay, and validation of the new decoder key.
Component tests prove fully static text does not change after multiple former
timer intervals while animated defaults still change. The live FHE flow asserts
the authored static decoder block and that a newly created session contains
none of the 18 canonical clues when unused eligible clues remain.
