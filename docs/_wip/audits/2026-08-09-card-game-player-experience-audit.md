# Card Game Player-Experience Audit

**Date:** 2026-08-09  
**Verdict:** Stop shipping this as a game. The framework is serviceable; the current player loop is not.

## Executive finding

The card game is an untimed scale drill with a hand of buttons in front of it. The card
choice has almost no strategy, the battle cannot be lost, mistakes cannot fail an action,
and successful play has almost no audiovisual payoff. More presentation polish would make
the same hollow loop prettier, not fun.

The first-wave document correctly called this a field pilot and required a go/revise/stop
gate. That gate has failed. Do not generalize the engine or add more content until one
narrow encounter earns replay willingness from actual players.

## Evidence

- The persisted card-game corpus currently contains 26 sessions: zero complete, 26 active.
  Twenty-four never left turn 1; one reached turn 2 and one reached turn 3. Some sessions
  are probably development attempts, so this is directional rather than a clean study,
  but it is still a disastrous funnel.
- Every completed challenge deals at least 2 damage. The enemy has 12 health and retaliates
  for 1 against a player with 8 health. The enemy can retaliate at most five times before
  dying, leaving the player at 3 or more health. **Defeat is unreachable.**
- A played card always ends the turn. Energy then resets to 2. A 1-energy card therefore
  wastes the remaining energy, and there is no option to play a second card. Energy cost
  is mostly decorative eligibility text, not a resource decision.
- `Steady Strike` strictly dominates `Quick Strike` at the same nominal cost. `Power Strike`
  strictly dominates `Heavy Strike`. Because only one card can be played, damage per turn
  is the real value and the weaker cards are traps.
- Every visible card is an attack and every action launches the same kind of eight-note,
  untimed scale task. The only mechanical variation is a number.
- A wrong note restarts progress, but the player has unlimited time and attempts. Eventually
  completing still deals reduced damage, which is enough to guarantee victory. There is no
  miss, block, enemy advantage, or interesting recovery decision.
- Card definitions still hard-wire specific scales. Hiding `C major` behind `Quick Strike`
  removed the visible scale picker, but pedagogy did not move to an adaptive backend policy;
  the card choice still secretly chooses the scale.

## Why players call it boring

| Failure | What the player experiences | Severity |
|---|---|---|
| No stakes | Health bars imply danger, but losing is impossible | Fatal |
| No meaningful choice | Pick the largest available damage number | Fatal |
| No card system | No defense, creatures, items, statuses, combos, targets, or card interactions | Fatal |
| Practice is a tollbooth | The battle disappears, the player performs a scale, then returns | Fatal |
| No authored opponent | `Rival` is a label plus automatic 1 damage; it has no intent or behavior | High |
| Success feels punitive | Even a perfect scale triggers unavoidable retaliation | High |
| No payoff | No attack animation, impact beat, sound, enemy reaction, reward, or earned reveal | High |
| No run arc | No deck-building, unlock, encounter choice, escalation, score, reward, or replay hook | High |
| Fake resource model | Energy is shown but cannot be planned across multiple plays | High |
| Hidden pedagogical coupling | The UI conceals the scale rather than selecting it through learner state | High |
| Thin mastery signal | Untimed ordered notes ignore tempo, rhythm, fingering, dynamics, and consistency | Medium |
| Weak onboarding | The screen explains the click, not the objective, consequences, or turn structure | Medium |
| No closure workflow | Persisted sessions remain active; there is no explicit abandon/restart/next encounter loop | Medium |

## What not to do

1. Do not add more identicons, gradients, card names, or enemies and call it fixed.
2. Do not expand the generic rules DSL. The current problem is missing game design, not
   insufficient abstraction.
3. Do not author fifty scale cards. More interchangeable arithmetic buttons increase
   content volume without increasing decisions.
4. Do not use engagement logging as a substitute for a playable hypothesis. Telemetry can
   locate abandonment; it cannot make the loop rewarding.

## Minimum viable rescue

Build one purpose-designed, five-minute encounter before resuming framework work:

1. Show the enemy's next intent: attack, defend, charge, or disrupt.
2. Give the hand genuinely different verbs: attack, block, focus, and one setup/payoff
   mechanic. Allow multiple cards per turn so energy becomes real.
3. Let performance quality change the tactical result: fluent earns the full effect or a
   bonus; recovered earns a smaller effect; an incomplete attempt has an explicit, fair
   consequence.
4. Decouple cards from curriculum. The card declares challenge requirements and effect;
   a pedagogy policy chooses the concrete scale from learner state after the card is played.
5. Render the result as a short combat beat: card commits, challenge resolves, damage/block
   animates, enemy reacts, intent advances, then the next hand becomes actionable.
6. End with a result and a reason to continue: score/reward, one upgrade choice, and a clear
   replay or next-encounter action.

Suggested vertical-slice content: one enemy with three intents, 8–12 cards, four verbs,
one synergy, and a three-to-five-turn encounter. No generalized DSL is needed to prove it.

## Release gate

Do not call the slice ready until supervised sessions demonstrate all of the following:

- At least 80% of players complete the first encounter without instruction.
- At least 60% voluntarily start another encounter.
- Card picks are distributed for tactical reasons, not explained solely by maximum damage.
- Players can explain enemy intent and why a recovered performance changed the result.
- Median challenge-to-combat-result delay is under 500 ms after persistence completes.
- Zero sessions become permanently stuck in a pending challenge.

## Adversarial conclusion

Three rescue directions were tested against the evidence:

1. **Polish the existing loop:** rejected because it leaves the impossible-to-lose arithmetic
   and interchangeable actions intact.
2. **Broaden the engine first:** rejected because it optimizes authoring capacity before a
   fun mechanic exists.
3. **Build a narrow tactical vertical slice:** accepted. It is the only option that tests
   both the game fantasy and the learning interruption without committing to speculative
   framework breadth.

The equilibrium recommendation is therefore: preserve the persistence/provider seams,
freeze generalization, and replace the battle rules and content with a deliberately small
tactical encounter. If that encounter cannot earn replay willingness, stop the card-game
concept rather than scaling it.
