# Kiosk Friction Detection — Design

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:writing-plans to turn this
> into an implementation plan once this spec is approved.

**Status:** design, not started.

## 1. Motivation

The week of 2026-09-15, three separate incidents on the household's two kid-facing
kiosks (the School Portal and the Piano tablet, `yellow-room-tablet`) ended the same
way: a parent physically walking over and operating a manual screen-off control,
sometimes twice, to stop a child mashing at a device. Full incident reconstruction
(stray keypad presses, an IME key mashed KR/EN for 8 seconds straight, a fabricated
ISBN credited as a finished book, a locked video restarted 7 times in under a minute,
rapid profile-hopping across every household member including both parents) is in the
session this design came out of; it isn't repeated here.

The distilled problem, in order of what actually cost the most:

1. There is no reliable, one-action way to stop an in-progress episode.
2. The existing "adult lockdown" (an NFC tag) is already used ~5x/week but only
   blacks out browser content — the Portal's physical buttons stay live, because the
   piece that would disable them (`portal_keys` APK integration) is deliberately
   shipped disabled pending a firmware rebuild.
3. Unattended kiosks offer zero resistance to a bored kid — every stray touch is
   treated exactly like deliberate adult input.
4. Trouble on one kiosk correlates with trouble starting on the other, with nothing
   surfacing that to a parent who is only in one room.
5. (Separate, not this doc) Input has no plausibility floor — a fabricated ISBN
   became a permanent "finished" record.

This design addresses **#3 and, as a direct consequence, #1 and #4**: give the
system its own first line of defense, so intervention becomes the exception instead
of the only tool. It does **not** cover #2 (device actuation reliability — a separate,
smaller follow-on) or #5 (input plausibility — separate, unrelated, cheap).

## 2. Scope

This is the first of three sub-projects identified during design:

| # | Sub-project | This doc? |
|---|---|---|
| 1 | **Detection → automatic per-device cooldown** | Yes — this document |
| 2 | Device actuation reliability (fix the manual screen-off's multi-step/FKB-bridge-absent flakiness; the Portal Keys APK rebuild) | No — separate, smaller spec |
| 3 | Bad-data hygiene (ISBN pattern blocklist; one-time cleanup of the fabricated record already in Learner1's shelf) | No — separate, bounded task |

Sub-project 1 is deliberately independent of 2: its consumer-side response is pure
software (Section 5), so it ships without waiting on the pending APK rebuild.

## 3. Architecture

```
raw signal (stray-press, code.rejected, ime-mash, add.rejected, video.restart...)
      │  frontend pre-filters bursts locally (e.g. "3 in 10s"),
      │  so we are not shipping every keystroke over the network
      ▼
POST /friction-ping  { deviceId, kind }              ← new, small, backend endpoint
      │
      ▼
KioskFrictionTracker (new application-layer service, NOT part of state-gates)
      │  maintains a rolling count per device over a short window (policy-configured,
      │  e.g. 5 minutes). The "is this bursty" arithmetic lives HERE, not in policy.
      ▼
publishes/corrects one assertion:
  kiosk.friction-score = <current rolling count>, subject: device, period: interval
      ▼
STATE GATES — reuses the existing comparison primitive, no new algebra:
  gate kiosk.friction-ok      = not(comparison: claim kiosk.friction-score gte <threshold>)
  gate household.not-locked-down = not(claim: household.manual-lockdown, subject: <household>)
  entitlement kiosk.<device>.access = all: [kiosk.friction-ok, household.not-locked-down]
                                        (failure_posture: fail_open)
      ▼
Portal / Piano kiosk poll + WS-refresh the entitlement, exactly the way
`useSchoolGameAccess` already consumes `piano.games` today.
```

**Why the rolling window lives outside State Gates:** State Gates' `count`
expression counts across a *set of subjects* sharing one period (e.g. "how many
learners finished chores today"); it has no "N events in the last M minutes for one
subject" primitive. Rather than force that shape into policy, the window math is a
small, independently-testable tracker service, and State Gates is asked to do only
what it already does well: turn a numeric claim crossing a policy-defined threshold
into a four-state gate and a binary entitlement decision — the same `comparison`
primitive `fitness.exercise.minutes gte 30` already uses.

**Why `fail_open`, the opposite of `piano.games`:** for `piano.games`, missing
evidence correctly means denied (the work isn't proven done). Here, missing evidence
must mean granted — no proof of chaos is not itself suspicious, and fail-closed would
leave every kiosk locked at boot with zero events logged. Anyone extending this
pattern by copying `useSchoolGameAccess`'s failed-read handling must flip that
direction deliberately; it is the single easiest mistake to make in this design.

## 4. v1 signal scope

Not every signal identified during triage gets new wiring in v1:

| Signal | v1 path |
|---|---|
| `code.rejected` (repeated) | Already hits the backend — one new side-effect call from the existing selfservice code-check handler. No frontend change. |
| `keypad.stray-press` burst | Frontend-only today. Locally pre-filtered (e.g. 3+ in 10s), then one `friction-ping`. |
| `add.rejected: not-a-book-prefix` burst | Same shape as stray-press. |
| IME-mash flurry | Same shape — this was the single loudest signal in the real incident data. |
| `piano.video.restart` mashing | Same pattern, Piano side. |
| Rapid profile-hopping across many subjects | **Deferred to v1.1.** It's real backend traffic (`/entitlements` calls per switch) but detecting the *pattern* means new per-device recent-subject bookkeeping, not a side effect on an existing call. |
| `gamepad.stale-poll-reseed` bursts | **Deferred, possibly indefinitely.** In the real data this fired constantly and steadily (every ~19s for 8 minutes) in a way that reads more like a normal idle controller than chaos. Wiring it without first confirming that against more data risks false-triggering on ordinary idle state. |

v1 wires five signals, all either already-backend or a small local pre-filter plus
one new ping call. This covers the two loudest incidents in the real week's data
(the IME-mash and stray-press episode, and the video-restart-mashing episode); the
deferred signals are candidates for a v1.1 once the tracker's real false-positive
rate is known.

## 5. Consumer-side response

`denied` triggers an **in-app soft-lock**, entirely inside the kiosk's own React
code, reacting to the entitlement exactly as `useSchoolGameAccess` already reacts to
`piano.games`:

- the ISBN pad / keypad / video controls stop accepting input;
- a plain "taking a short break" cover state replaces the screen;
- it self-clears when the gate returns to satisfied (the rolling window ages out) —
  no adult action required for the common case.

This is deliberately **not** routed through the FKB bridge or the Portal Keys APK.
Both of those are documented as unreliable or incomplete today (Section 1, #1 and
#2), and building the automatic response on top of an unreliable manual-response
path would inherit its failure modes. The hardware screen-off remains available as
the human escalation path for a kid who somehow defeats the in-app cover — that's
sub-project 2's territory, not this one's.

## 6. Manual-override composition

The NFC tag (`ShutdownService.activate()`) and the Keypad's own manual screen-off
button don't publish anything to State Gates today — they call device APIs directly.
Rather than rearchitect that hardened, already-careful code, the integration is
**additive**: `activate()` (and its release path) gain one new side effect — publish
(or retract) a `household.manual-lockdown` boolean claim, subject: household, bounded
by the same `lockedUntil` the service already computes. See the composed entitlement
expression in Section 3.

Worth naming explicitly: because the kiosk's reaction to `denied` is pure software
(Section 5), this composition means the NFC tag — already used ~5x/week — starts
actually reaching the Portal's own on-screen controls immediately, without waiting on
the pending APK rebuild. That gap does not need to close for this design to ship.

The keypad's existing per-device manual screen-off button is left as-is; it already
targets one device directly and isn't entangled with this entitlement. Its
reliability (FKB-bridge-absent fallbacks, the two-tap arm/confirm flow) is
sub-project 2.

## 7. Error handling

| Failure | Resolution |
|---|---|
| `friction-ping` doesn't reach the backend (tracker down, network blip) | Fire-and-forget from the client; swallow the failure. Must never block or degrade the actual feature (logging a book, playing piano) waiting on an ack — same posture the existing grading hook already uses for a slow/broken Home Assistant call. |
| State Gates unreachable when the kiosk reads the entitlement | Resolves to **granted**. A `useSchoolGameAccess`-style "failed read stays closed" pattern must not be copied verbatim here — this posture is inverted, and a State Gates outage must never itself become an accidental household-wide lockout. |
| Friction score decay | No active decrement job. The assertion's own validity window lapses if no new event arrives; that resolves to indeterminate → fail-open → granted, for free. The tracker only ever needs to republish on a *new* event, never on a quiet one. |
| False positive (fast legitimate use, e.g. a genuine quick re-read of a short book) | Low cost by design: threshold is a policy value, not hardcoded, and the consequence is a brief, self-clearing soft cover screen — not a hard device lock or a lost credit. |

## 8. Testing

- **Tracker unit tests** — pure, no I/O: given a timestamped ping sequence, assert
  the computed rolling count. Same shape as the existing `omrAlignmentError` tests.
- **Policy-level tests** — a fixture policy graph plus posted assertions, asserting
  the resulting entitlement decision, following State Gates' own existing test
  patterns for policy activation and evaluation.
- **Frontend hook tests** — a new `useKioskAccess`-style hook mirrors
  `useSchoolGameAccess.test.jsx`'s shape: granted / denied / fail-open-on-read-
  failure cases.
- **Regression fixture (must-trigger)** — replay the actual reconstructed friction-
  ping sequence from the 2026-09-18 6:13pm incident (stray-press burst + IME-mash
  flurry) through the tracker and assert it crosses the configured threshold. This is
  the mirror of the OMR alignment spec's Learner1 fixture, but proving the *positive*
  case instead of a must-not-trigger one.

## 9. Non-goals

- No auto-escalation to a hardware lock. The soft-lock is the entire automatic
  response; a human still decides whether to go further.
- No behavioral profiling across days/weeks, no per-child modeling. The tracker is
  purely per-device, purely a short rolling window, reset on every quiet period.
- No coverage of the rapid profile-hopping or gamepad-reseed signals in v1 (Section 4).
- No change to the existing per-device manual screen-off button's reliability — that
  is sub-project 2.
- No input-plausibility validation (fake ISBNs, etc.) — that is sub-project 3.

## 10. Open questions

1. The rolling-window length and the friction-score threshold are policy values and
   must come from real data, not a guess here — same caution as the OMR alignment
   spec's `MIN_ITEMS`/`MARGIN`. Starting suggestion: a 5-minute window, threshold
   tuned after watching a week of real `friction-score` values with the soft-lock
   *logged but not yet enforced* (a dry-run period), rather than picked cold.
2. `KioskFrictionTracker`'s home in the codebase — likely
   `backend/src/3_applications/devices/` alongside the existing
   `PianoScreenAuthorityService`/`PianoMidiWakeService` siblings, but worth
   confirming against `5_composition` wiring conventions during planning.
3. Should the soft-lock cover state say *why* (e.g. "let's take a break from typing
   for a minute") or stay generic? A specific message risks reading as an accusation
   to a legitimately fast-typing adult; a generic one risks confusing a kid who
   doesn't understand why the screen changed. Worth a short product decision before
   implementation, not guessed here.
