# Story Time Reachability — Design

**Status:** proposed, awaiting review
**Date:** 2026-08-26

## 1. The problem, stated exactly

On 2026-08-26 Soren tapped his card at the living-room reader and then tapped a
book. Nothing happened. The obvious diagnoses were all wrong, and each one cost
time:

- It was not the TV or the Shield — both were already on.
- It was not the ESP32 relay. The reader is an outbound WebSocket client and
  its taps reached the backend; the log store held five of them for
  `04f65300cc2a81`.
- It was not a missing route or a missing feature. `StoryTimeProgramLauncher`,
  `RecordStoryRead`, `readingSessionInterceptor`, `ReadingSessionScreen` and the
  `story-read` ceremony all existed and all worked.

The actual cause was one absent line of configuration. The living-room source in
`data/household/triggers/sources.yml` declared no `learner_action`, so
`NfcResolver` resolved the card, produced a null intent, and routed the tap into
the ordinary unknown-tag capture. Every layer behaved exactly as written.

**Alan and Soren were assigned a daily obligation that nothing in the house was
configured to let them start, and the system had no opinion about that.** It is
the gap between "assigned" and "startable" that this design closes. Adding the
missing line fixed today; it did not make tomorrow's equivalent detectable.

## 2. Scope

In scope: making an unstartable assignment impossible to ship silently.

Out of scope: the story-time feature itself. The launcher, the credit rule, the
target-per-learner enrollment, and the unknown-book path are all built and are
not changed here. This design adds no new child-facing behaviour on the happy
path.

## 3. The invariant

> A program a learner is assigned must have at least one configured entry point,
> and a household where that is not true must say so without being asked.

Two words carry the weight. **Configured** — not "wired", not "deployed":
`sources.yml` is data, and the failure lived in data. **Without being asked** —
today's failure was fully visible in the logs to anyone who thought to look; the
whole cost was that nobody knew to look.

## 4. Approaches considered

**A. Boot-time assertion.** At composition, cross-check every learner's assigned
programs against the `learner_action` values declared across all trigger
sources; refuse to boot, or log an error, on a gap.

*For:* loudest and earliest; one check, no per-day cost.
*Against:* couples school composition to trigger configuration at startup, and a
boot-time error is seen once, by whoever happened to be deploying — which on
this host is often an agent, not a person. It also cannot distinguish "no reader
configured" from "reader configured but unplugged", and overreaching into the
second would make deploys fail for reasons that are not deploy problems.

**B. Extend `school:certify`.** The linter already exists
(`cli/school.mjs certify`) and already refuses malformed content. Teach it to
lint reachability too.

*For:* fits tooling that exists, runs in CI, no runtime coupling at all.
*Against:* it is only as good as the last time somebody ran it. It would not have
caught today, because nobody had reason to run a content linter after editing a
trigger source. A check that depends on remembering to run it is the same class
of failure as the one being fixed.

**C. Agenda-time honesty (recommended).** When the day is planned, a program
section whose entry point is not configured is `faulted`, with a reason. That
propagates through machinery that already exists: `resolveDayCompletion` turns
any fault into `indeterminate`, so the day is never reported complete, and the
teacher console's planner-refusal surface (`errors` on the agenda preview) can
name it.

*For:* it surfaces where a human already looks every single day, and it cannot
be forgotten. It reuses the obligation vocabulary rather than inventing a second
notion of "broken". It is also the honest state: a child who cannot start a
required program has not finished their day, and saying "complete" would be a
lie. Critically, `indeterminate` already means "not evidence of a finished day",
so the status board and the new done-for-the-day receipt line both stay quiet
rather than falsely congratulating a child.
*Against:* it reports the morning of, not at deploy time.

**Recommendation: C, plus the cheap half of A.** C is the safety net that gets
seen; a startup `warn` naming any unreachable assigned program is a few lines
and gives the fast signal without making deploys fail. B is deliberately
declined — adding a lint nobody is prompted to run would create the appearance
of coverage without the substance.

## 5. Design

### 5.1 The reachability fact

A pure domain function, given the set of `learner_action` values any trigger
source declares and a learner's assigned programs, returns the programs with no
entry point.

It is pure and takes the declared actions as an argument rather than reading
configuration itself, for the same reason `RecordStoryRead` takes `studyDay` as
a parameter: a second, independently-resolved source of the same fact is how
two parts of a system come to disagree without anything erroring.

### 5.2 Where it is applied

At agenda planning, a program section whose `programId` has no configured entry
point gets `obligation: { state: 'faulted', reason: 'no_entry_point' }`. Nothing
downstream needs to change: `resolveDayCompletion` already folds `faulted` into
`indeterminate`, and the agenda preview already exposes `errors` for the teacher
console to render.

At startup, the same function runs once over the roster and emits one `warn` per
unreachable program. A warn, not a throw: a household mid-setup is a legitimate
state, and refusing to boot would take down four children's school day over one
child's misconfigured program.

### 5.3 What the child sees

Nothing new on the happy path. On the broken path the child's agenda does not
claim the program is startable, and the day does not report complete — which is
the point. The child is not asked to fix a configuration problem, because they
cannot.

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| Program assigned, reader configured, reader offline | NOT a reachability fault. Configuration is present; this is a hardware condition and belongs to the existing device-health path. Conflating them would make a dead battery look like a config error. |
| Reader configured at a different location than expected | Reachable. The invariant is "at least one entry point", not "the right one" — asserting location would encode a house layout into the domain. |
| Program assigned to one learner, reader configured | Reachable for all. `learner_action` is per source, not per learner. |
| Learner not enrolled in the program | Not evaluated. `StoryTimeProgramLauncher.status()` already distinguishes not-enrolled from unreadable, and not-enrolled is not a fault. |
| Unknown/untagged book tapped | Already handled — `readingSessionInterceptor.noteUnknownTag` broadcasts `book-unknown`. Unchanged by this design. |
| Story abandoned partway | Already handled — `RecordStoryRead` records on FINISH only, by design. No partial credit. Unchanged. |
| Trigger config unreadable at startup | Fail toward reporting: treat the declared-action set as empty, so every assigned program reports unreachable rather than every program silently passing. "I could not tell" is not "everything is fine" — the same rule the deploy gate uses. |

## 7. Testing

- The pure function: assigned-with-action, assigned-without-action, multiple
  sources declaring the same action, empty declared set (the unreadable-config
  case above), learner with no programs.
- The agenda fold: a faulted program section makes `resolveDayCompletion` return
  `indeterminate`, and therefore the status board does not show a done chip and
  the result receipt does not print the done-for-the-day line.
- A regression test reproducing 2026-08-26 exactly: story-time assigned, no
  source declaring `reading-session`, assert the day is not reported complete
  and the program is named in the agenda's `errors`.

## 8. What this deliberately does not do

It does not verify that a configured entry point *works* — that a reader is
powered, paired, and reachable on the network. That is a real question with a
real answer and it is not this design's question. Today's failure was not a
device that stopped working; it was a device that was never asked to.
