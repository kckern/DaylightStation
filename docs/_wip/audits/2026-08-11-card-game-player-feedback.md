# Card Game Player Feedback

**Date:** 2026-08-11  
**Source:** Supervised player session  
**Scope:** Feedback relevant to `frontend/src/modules/Piano/PianoCardGame/CardGame.jsx` and its hosted game experience.

## Summary

The player understood the core loop: choose one of three starting partners, tap an attack,
and play the requested notes on the piano. They discovered that attacks differ in strength
only through use, and then consistently selected the strongest option. They did not lose a
partner and described the game as "kind of" too easy. After completing the initial three
opponents, there was nothing meaningful left to do.

The player wants the piano battles to become the opening of a longer, saveable adventure:
progress through levels, earn choices from defeated opponents, periodically face stronger
leaders, build a retained partner roster, and reach a clear end goal. They also suggested a
less text-heavy card presentation and piano-keyboard support for attack selection.

## Observed experience

| Area | Player feedback | Implication |
|---|---|---|
| Attack choice | Attack strength is learned by trying it; the strongest option becomes the obvious choice. | Make effects legible before commitment and provide situational tradeoffs rather than a dominant attack. |
| Piano challenge | Incorrect notes greatly reduce damage; the player repeatedly achieved direct hits. | Preserve quality-sensitive scoring, but modestly raise challenge difficulty and test it against player skill. |
| Difficulty | No partner fainted; the player called the game somewhat too easy. | Create a credible loss or setback condition, with fair recovery and visible stakes. |
| Completion | Finishing the three starting-partner paths left no next action. | Provide a completion screen and an immediately actionable next level or replay path. |
| Card presentation | Cards looked busy. | Reduce visible text; prioritize effect, cost, and the musical prompt. |
| Input | Attacks currently require touch selection. | Support selecting attacks from the piano keyboard, subject to avoiding conflict with note-play input. |

## Requested progression loop

1. **Level 1:** Choose among the three starting partners and complete their initial battles.
2. **Level completion:** Show a chart/summary confirming that the first level was completed
   with all three starting partners, then unlock the next level.
3. **Future levels:** Let the player choose from opponents defeated in the preceding level.
4. **Roster growth:** After every two completed encounters, offer another partner to retain.
   The player may field an earlier defeated opponent or a retained partner rather than being
   forced to use only the current level's choices.
5. **Leader encounters:** After every five battles, require a stronger leader battle with
   five player attacks and an opponent roster of four partners.
6. **Victory condition:** Finish the game by either collecting 50 partners or defeating 30
   leaders.
7. **Save/resume:** Expose a save action so a player can stop during a long run and resume
   later.

## Design decisions still needed

- Specify what makes a leader battle tactically different beyond larger attack and roster
  counts.
- Define whether a partner is *defeated*, *earned*, or *captured*, and when it becomes
  selectable. The player used these ideas interchangeably.
- Define the roster size, how a player switches an active partner during battle, and how
  retained partners interact with level-specific choices.
- Decide how keyboard attack selection is entered and confirmed without accidentally
  triggering musical-note grading.
- Validate whether the proposed 50-partner / 30-leader completion targets fit the intended
  session length and save cadence.

## Recommended next slice

Before building the full campaign, prototype one two-level flow: complete the three starter
encounters, show the level-complete summary, unlock a meaningful choice among defeated
opponents, and permit save/resume. Pair it with slightly harder piano grading and clear
attack effects. Test whether the player understands why they chose an attack and voluntarily
continues into level 2.

This extends the existing 2026-08-09 player-experience audit: its concerns about dominant
attacks, unreachable defeat, thin payoff, and no run arc were directly reflected in this
player session.
