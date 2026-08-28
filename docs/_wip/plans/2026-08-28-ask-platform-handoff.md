# Ask Platform — Handoff (session ran out of tokens)

**Stopped:** mid-review-dispatch for SP1 Task 6 (the last task of SP1). No data lost —
everything below is recoverable from git + the SDD ledger.

## The goal (active `/goal`, verbatim)

One challenge system for the piano that any screen can use, fully driven by config —
instead of logic wired into the games gate specifically. Four sub-projects:

- **SP1** — foundation: extract the ask pipeline into `askSchema.js` + `AskSession.jsx`,
  re-seat all existing hosts on it. No visible change except closing bug-report C1
  (program/video steps get real framing copy).
- **SP2** — new presentations: `recall` prompt (named asks, e.g. "Play a C major chord"
  for Alan), `pitchClass` grading policy flag (octave/voicing-agnostic), `engraved`
  notation for free timing (Felix's scales as real quarter notes), single-note reading
  card. **Alan and Felix are waiting on this.**
- **SP3** — four new hosts: placement test, kiosk-home lesson gate, school piano lesson
  (feeds Games gate 1), earned game time (D14, mints minutes on pass).
- **SP4** — config grammar rollout + bank content (chromatic, harmonic/melodic minor,
  warm-up figures) + docs generated from the schema.

Full specs: `docs/superpowers/specs/2026-08-28-ask-platform-roadmap-design.md` and
`docs/superpowers/specs/2026-08-28-sp1-ask-platform-design.md`.

## Where things stand

**Branch:** `feat/ask-platform`, cut from `origin/main` @ `96ce369cd`. **Not merged, not
pushed, not deployed.** The kids are running the OLDER shipped gate (from the
`feat/exercise-run-ux` branch, already merged to main and deployed) — this new branch
has zero effect on them yet.

**SP1 plan:** `docs/superpowers/plans/2026-08-28-sp1-ask-platform.md` (6 tasks + Task 5b,
which I inserted mid-flight — see ledger).

**Ledger (read this first, it's the full record):**
`.superpowers/sdd/2026-08-28-sp1-ask-platform/progress.md`

**SP1 task status, all reviewed and closed except the last:**
- Task 1 `askSchema.js` — ✅ closed, 1 fix round (validateAsk false-ok bug)
- Task 2 stage resolution → schema — ✅ closed, clean first pass
- Task 3 `AskSession.jsx` extraction (the pivotal task) — ✅ closed, 1 fix round
  (`materialSpec` overload — chose "resolve the authored spec" as the fix shape)
- Task 4 `GameGate` on the seam (the LIVE host) — ✅ closed, 1 fix round (schema-refused
  ask failed open — one YAML typo would have granted free matches forever; now
  substitutes correctly)
- Task 5 practice/program/video hosts, C1 closes — ✅ closed, 1 fix round (untested
  primary checkpoint door in `Videos.jsx`)
- Task 5b `deriveStage` wired, `runPresentation` reduced (I assigned this — two spec
  items were orphaned across Tasks 2-5) — ✅ closed, zero findings
- **Task 6 (compat-path deletion + 2 flake fixes + full gate) — IMPLEMENTED, commit
  `ef49edbb9`, but the review was NEVER DISPATCHED — this is the resume point.**

## Resume point: dispatch Task 6's review

```bash
/home/claude/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills/subagent-driven-development/scripts/review-package \
  docs/superpowers/plans/2026-08-28-sp1-ask-platform.md e9276f3f2 ef49edbb9
```
(This was already run — the package exists at
`.superpowers/sdd/2026-08-28-sp1-ask-platform/review-e9276f3f2..ef49edbb9.diff`, 116KB,
3 commits: `d408fb80c` compat deletion + metronome flake fix, `d5206516f` deleted
`pickGateMaterial`, `ef49edbb9` chess persistence flake fix.)

**The implementer's headline claim, UNVERIFIED — check this hardest when you resume:**
They report the compat-path migration exposed and fixed a live bug: `ExerciseRun`'s
subject-reset ran in a `useEffect`, and on the commit that mounts a score,
`ScorePassage` reports `unrunnable` from ITS effect and the parent's reset immediately
erased it — leaving a child on "Getting the music ready…" forever, Leave the only way
out. They say it's been live since Task 5, invisible because only the compat path (whose
guard skipped the reset) exercised a failing engraver, and it's fixed with a
"render-phase adjustment." **This needs independent verification before trusting it** —
if real it's a Critical about currently-shipped code (Task 3/4/5 all passed review
without catching it).

Also verify: the 1,308-line test migration didn't weaken assertions; the −2 test-count
delta (414/5098→414/5096) nets out honestly; the "3 pre-existing reds, this branch is
BEHIND not ahead of origin/main" claim (verify via `git diff origin/main` on the
differing file, reported as `ScreenScreensaver.jsx`); both flake fixes are proven (5×
solo + 2 sweeps each), not just "didn't fail this time."

Use the `Agent` tool, `subagent_type: general-purpose`, `model: opus`, matching the
review-prompt pattern used for every prior task in this ledger (see the ledger file for
the exact prompt shape — every review in this SDD run followed the same template:
Spec Compliance table → hardest-claim verification → Quality Findings graded
Critical/Important/Minor → Verdict).

## After Task 6 closes: SP1 is done

Then: SP2 next (recall + engraved presentations — what Alan/Felix are waiting on),
following the same SDD pattern (`/superpowers:writing-plans` off the roadmap spec's SP2
section → `subagent-driven-development` execution).

## Standing rules for this whole effort (do not relitigate)

- **Never `git stash`** — shared stack across sessions. A subagent popped someone else's
  stash once on the previous branch; recovered via `git fsck --unreachable` +
  `git stash store`. Every implementer dispatch must carry this rule explicitly.
- **Never bare `git checkout <file>` with uncommitted work** for teeth checks — use
  scratchpad copies.
- **No config change deploys with this SP** — SP1's live YAML is legacy-shaped and
  `expandAsk` serves it unchanged. Do NOT touch `data/household/piano/config.yml` as
  part of SP1.
- **Deploy gate discipline** (from CLAUDE.local.md): `./scripts/deploy-gate.sh` as its
  own step, must HALT (exit 1 = do not deploy), re-run after build.
- **Watcher gotcha I hit this session:** when polling for a commit to land, capture the
  REAL `git rev-parse HEAD` into a variable inside the same command that waits on it —
  padding a short SHA into a fake full SHA makes the comparison true immediately.
- Reason vocabularies are FROZEN across the whole platform:
  `onUnavailable` = `no-access|instance-not-found|unrunnable`; material declines =
  `no-score-source|no-collection-or-instance|unknown-material-kind|instance-unavailable|
  catalog-unavailable|score-unavailable`; `onFailed` = judged attempts only
  (`completed ∪ timeout`, never `aborted`); mode = `free|cued` only, never matcher names.
- Two known pre-existing reds on `origin/main`, NOT this branch's problem: two
  ScreenProvider mock gaps (`useScreenAmbient`, `FitnessSessionDetailWidgetDelete`) and
  `band.measure.test.jsx`'s 1-of-102 Surround assertion.

## Live production state (unaffected by any of this)

Five users on the OLD gate (`feat/exercise-run-ux`, merged + deployed earlier today):
`kckern` (L2, chess only), `felix` (L2), `alan` (keys-2, interim until SP2's recall
ships), `soren` (keys-1), `milo` (L1). Household default off. Zero gate events observed
in the log store since that config landed — no kid has met their gate yet as of the last
check.
