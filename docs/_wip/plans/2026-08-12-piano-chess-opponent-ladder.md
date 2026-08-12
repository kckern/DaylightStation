# Piano Chess — the opponent ladder (21 personas)

**Date:** 2026-08-12
**Status:** Captured from a live conversation, not yet designed or built.
**Depends on:** the game record (already shipped), the config pair (already shipped).

## What was asked for

Turn the flat five-rung difficulty list into a **progression a child climbs**. The engine already
exposes Skill Level 0–20 — a blundering buffoon at 0, unbeatable at 20 — so there are 21 natural
opponents. A player meets them in order and has to earn the next one.

### Promotion is by recent form, not by a lifetime tally

Beating an opponent once is luck; beating them ten times last month says nothing about today. The
rule wanted is a **sliding window** — something like "win 5 of your last 7 against this opponent" —
so promotion tracks current skill and a player who has gone cold does not carry a stale
qualification forward. The exact numbers are a policy, not a constant: they belong in YAML.

### Personas, not numbers

Each of the 21 opponents is a character with a name and a face, because "Skill Level 7" is not
something a five-year-old wants to beat.

- **Default set:** a generated identicon per level plus generic names, graded so they *sound* like
  what they are — docile and harmless at the bottom, `Brutus`-flavoured at the top.
- **Override set:** the whole roster is replaceable from YAML. The wanted first override is
  **Pokémon** — the card game at `frontend/src/modules/Piano/PianoCardGame/` already ships Pokémon
  artwork and names, so the weakest creatures sit at level 0 and the legendaries at 20, and the
  children experience the ladder as battling their way up a roster they already care about.
- The override is data only. The ladder's arithmetic must not know what a Pokémon is.

## Where the state lives

This follows the split the app already uses, and the user confirmed it explicitly:

| What | Where | Why |
|------|-------|-----|
| The ladder policy — promotion window, how many of the last N, the persona roster and which override is active | Household YAML (`data/household/config/chess.yml`) | It is a rule about how the game works, the same for everyone unless deliberately changed |
| A player's progress — which opponents are unlocked, which is current, recent results per opponent | Per-user scope (`data/users/{id}/apps/chess/`) | It is that child's earned position, and two children on one kiosk must never share it |

Per-user overrides of the policy stay possible through the existing merge, so one child can be put
on an easier promotion rule without changing the house.

## Open questions for the design session

1. **Does a loss demote?** A sliding window implicitly does — falling below the threshold could take
   the next opponent away again. That may be motivating or crushing; it needs a decision, not a
   default.
2. **Is the current opponent chosen or assigned?** Free re-play of already-beaten opponents is
   valuable practice; being able to skip ahead defeats the ladder.
3. **What counts as a game?** Resignations, abandoned games, and games where the player used the
   best-move hint every turn should probably not count toward promotion — the record already stores
   hint and best-move tallies, so the policy can see them.
4. **How does the ladder reconcile with the existing `rungs` list?** The five named rungs and a
   21-step ladder are two answers to the same question; one of them should go.
5. **Where does the persona appear in the chrome?** The state rail names the level today; a face
   and a name want more room than that row has.

## Not in scope for this capture

The addressing vocabulary (chords vs. staff) is a separate axis and is already built. A child can be
a strong reader and a weak chess player, or the reverse, so the two ladders must not be coupled.
