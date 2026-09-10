# Sentence Ladder — outcome, 2026-09-10

Picks up [`2026-09-09-sentence-ladder-handoff.md`](./2026-09-09-sentence-ladder-handoff.md)
and closes it. Read that first for what shipped on the 9th; this says what happened to the
three things it listed as unfinished, and corrects three of its claims that did not survive
contact.

---

## 1. What is now done

### The observability sweep (handoff §3a) is finished

Every transition the handoff listed as silent now says something. The rule the sweep already
had is unchanged: **per-sentence traffic at `debug`, landmarks and consequences at `info`,
refusals at `warn`** — the store is a 7-day disk cap shared with fitness telemetry at 5s
resolution.

| Now recorded | Why it was worth a line |
|---|---|
| `program.day-loading` (debug) | A day was ASKED for, with the capabilities it asked with. A request that never returns used to be indistinguishable from a program nobody opened |
| `program.day-loaded` (info) | Gained the chain, the blocked rungs and the round trip in ms |
| `program.tab` (debug) | A move to the Review shelf — what a session that "never gave me any sentences" usually is |
| `rung.landed` (debug) | Which rung **and why**: `first`, `resume`, `rung-cleared` |
| `rung.selected` (debug) | The learner chose a rung themselves |
| `rung.held` / `.replayed` / `.advanced` (debug) | Repetition's choice, the feature that shipped unobservable. A replay is never a `complete` |
| `rung.practice` (debug) | The extra-practice banner — why the same sentence keeps arriving |
| `capability.rung-blocked` (info) | A dimmed rung and the capability it lacks (`microphone`, `textInput:KR`), once per day, not per render |
| `capability.overridden` (info) | Gained `from` and `changed`: readable on its own, without diffing against an earlier event |
| `pacing.changed` (info) | Gained `from`. "The limit is 20" never said it used to be 5 |
| `pacing.roll-refused` / `.change-failed` (warn) | A button pressed and declined. From the child's side that is a dead button |

Where the telemetry lives is now a decision rather than an accident. `DeviceSettings` and
`PacingControl` stay presentational and log nothing, and both say so in a comment: a capability
change is recorded once by `useCapabilities.update` (which also catches the Recording rung
switching the mic off after a denial), and a pacing change is recorded by the shell's
`onPacing`, which is the only side of the call that knows whether the server took it.

Documented in `docs/reference/school/sentence-ladder.md` ("Reading a session back") and in
`docs/runbooks/school/logs-and-tracing.md`, which now carries a Sentence Ladder event table and
the three launch-day queries — everything for one run, everything the ladder said in an hour,
and only what went wrong.

### It has now been watched running (handoff §3b), and that found three bugs

Both are fixed, both with a test that fails without the fix.

**1. An identity lapse with the ladder up left a blank wall.** The ten-minute idle lapse nulls
the study grant, so the runner unmounts — but `section` stayed set, and the locked panel's
`Done` overlay deliberately does not draw over the ladder (it carries its own exit). The result
on the Portal: no ladder, no keypad, no control at all, on a kiosk with no address bar. The
shelf's identical dead end had already been found and fixed; this one sat one condition away
from it in the same expression. A lapse now ends the session and returns the panel to the
keypad.

**2. The code-free door opened onto nothing for an off-roster learner.** Every runner gates on
`currentUser`, which is a lookup into the School **roster**. `/school/go/<learner>/…` claimed
whatever id the URL named, reported a successful launch, changed section — and painted nothing,
with no error and nothing in the console. It now refuses by name: "grownup is not on the School
roster", with a way back.

**3. The ladder's card had no picture, and the poster was on disk all along.**
The plan's own verification step asks for
`/self-service/programs/sentence-ladder/glossika-korean/poster.jpg` and expects
`200 image/jpeg`; it answered 404. The file sits exactly where the datastore
documents it —
`media/school/programs/sentence-ladder/glossika-korean/poster.jpg`, 734KB — and
both routes pass the corpus. **Three seams between them took `(programId)`
alone and dropped the second argument**: `CurriculumAccess`,
`FitnessCourseCurriculumCatalog` and `SchoolCurriculumQueryService`. A dropped
parameter is invisible — no error, no log, just a card that draws its calm
placeholder forever, which is indistinguishable from a program that has no
artwork. Threaded through, with the seam pinned by a test that fails without it.

The second bug is why the handoff's test rig was never run: it was built for an adult, and an
adult is not on the School roster. **A blank screen was the rig working as designed.**

### Verified by eye, on the real deployment

Driven headlessly (Playwright against `daylightlocal.kckern.net`), on the real corpus through
the teacher preview route — `/school/sentence-ladder-preview/glossika-korean` — which needs no
learner, mints no grant and writes no evidence:

- The stage **does not move** between drill phases: 0.0px on `playing → done`, which is the
  defect Task 2 was fixing.
- A finished sentence is **held**: "Play again" and "Next" appear, and the sentence on screen
  is still the one just heard.
- **Next advances and plays**: the next sentence arrives already sounding, no second tap.
- A dimmed rung names a keyboard where a keyboard is what is missing.
- The card's poster is served (after the fix below), rather than 404.

### The debug events could not be turned on at all — the sweep was shipping dark

The handoff's very first instruction, and the thing launch week depends on, was
`window.DAYLIGHT_LOG_LEVEL = 'debug'` in the browser console. **On the School
surface that did nothing.** `Logger.js` — which is what `languageLog` writes
through — takes its level only from `configure()`, and nothing on this surface
ever called it. The window flag is read by a *different* module (`singleton.js`,
the shell logger), so the instruction looked plausible, changed nothing, and
said nothing about it. Every debug event this branch added, and every one the
ladder already had, was unreachable in production by any means.

`?debug=1` on the URL now raises the level at mount and puts it back on
unmount, the way the Feed surface has always done it. A panel cannot be left
chatty by a diagnostic session. The runbook and the reference both carry the
correction; assume any older instruction naming the window flag alone is wrong.

**And it only goes as far as the console.** The backend drops incoming `debug`
at ingest in production (`defaultLevel: info` in the dispatcher), whatever the
browser is set to — verified by running a session at debug and querying its run
id: the console showed the full trace, the store held only the info and warn
rows. So the plan's acceptance criterion ("a single runId query returns the
whole session … each rung entered and completed, each API call") is not
reachable as written, and no instruction in a runbook can make it so; it needs
a container-level config change that would flood the store with every other
frontend's debug traffic too. What was done instead: **`rung.landed` was
promoted to `info`** — which rung a child is on and why they were put there is
where a support call starts, and a handful of events per session costs nothing.
Everything else per-sentence stays at debug, console-only, and the docs now say
which is which rather than implying the store has it all.

What a single run id **does** return from the store, confirmed on the live
deployment: program mounted, each day load with its chain and blocked rungs,
each progress state, capability detection and overrides, dimmed rungs and what
they lack, pacing changes and refusals, API warnings and errors, the rung
landings — and the backend's own events for the same run. The frontend→backend
half was proved separately with an unauthorized request carrying a run id: the
403's `study-grant-refused` came back from the store under that same
`context.runId`, without writing a byte of learner evidence.

## 2. Three of the handoff's claims that did not survive

1. **"The test rig's audio is shared from the real corpus's media folder."** It is not. Every
   clip under `glossika-korean-test` answers 404; the real corpus answers 200 `audio/mpeg`. The
   rig could never have demonstrated audio. (Deleted — see §3.)
2. **"`DeviceSettings.jsx` — 0 events. If someone toggles it tomorrow, nothing records it."**
   Half right. The file had no log calls, but every row toggles through `useCapabilities.update`,
   which has always logged `capability.overridden`. The real gap was precision, not silence:
   the event said what the device now claims and never what it changed from. Counting log calls
   per file measures files, not coverage.
3. **"A stray plan file in `plans/learners/` is exactly the kind of thing that gets read by
   accident."** Not by the code: `YamlAssignmentStore.list()` filters every filename through
   `^[a-z0-9][a-z0-9_-]*$`, and a Dropbox conflicted copy has spaces and parentheses, so it was
   never a candidate. It was still a hazard for the human the file exists for — this is the one
   School file a grown-up is expected to edit by hand — so it has been moved out.

## 3. Environment, left clean

- **The test rig is gone**: `data/content/school/language/glossika-korean-test.yml` and the
  plan file `data/household/school/plans/learners/kckern.yml`, moved to `data/_deleteme/` —
  never `rm`-ed; the rule holds even for a file created for a test. There was no
  `data/users/kckern/apps/school/language/glossika-korean-test/` to move: the rig never ran far
  enough to write one, which is its own confirmation of §1. (KC's `glossika-korean` progress
  directory beside it is real and untouched.)
- **The conflicted plan copy is out of `plans/learners/`**, moved to
  `data/_deleteme/2026-09-10-school-plan-conflicts/`.
- `docs/docs-last-updated.txt` moved forward.

## 4. Still open, deliberately

Unchanged from the handoff §4, and still deliberate: Recording's review phase exceeding the
control-row floor below ~664px stage width; `TypedRung`'s blocked alert pushing content down;
`$disc` in rem beside px neighbours; the dead `.filter(([, need]) => need)` clause.

Two from the handoff that are NOT mine to close:

- **The log store still has no Cloudflare Access token.** One perimeter rule stands between the
  open internet and the children's telemetry, and this branch added a great deal more of it.
- **Handoff §3c's un-reviewed commits** (Tasks 3, 5, 8a and the run-id wiring). Task 3's state
  machine has now been watched running end to end, which is not the same as a review, but it is
  no longer only a self-report.
