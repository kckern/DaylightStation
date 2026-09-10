# Sentence Ladder — handoff, 2026-09-09

**Deployed:** `3913e61ad`, live on the prod container (`/build.txt` confirms the commit,
health check green, `/app/school` and the ladder API both answering 200).
**Gate at deploy:** 853 files, 10,990 tests, exit 0.
**Children start using this program tomorrow morning.**

This is written for whoever picks it up next, including me. It says what is done, what is
half-done, and what I got wrong — because two of those three are the parts that cost time.

---

## 1. Do these first, before the children start

### Raise the log level. The observability shipped switched off.

Every per-sentence and per-request event added yesterday sits at `debug`, which is filtered
out by default. The instrumentation exists and currently emits nothing.

In the browser console on the surface running the ladder:
```js
window.DAYLIGHT_LOG_LEVEL = 'debug'
```
or `configure({ level: 'debug' })` from `frontend/src/lib/logging/Logger.js`.

**Turn it back down after launch week.** The log store is 7-day retention with a disk cap and
is shared with every household subsystem — fitness heart rates at 5s resolution live in there
too. A chatty module evicts other people's data.

### Know the three queries

```bash
# One child's whole session, both sides, in order — this is the new capability
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=context.runId:"<id>" AND _time:1h | sort by (_time)'

# Everything the ladder said in the last hour
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="school.language" AND _time:1h' -d 'limit=200'

# Only what went wrong
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query="school.language" AND level:error AND _time:1h'
```

`context.runId` is minted per program run and travels to the backend on `X-School-Run-Id`.
Before this existed, a frontend save and the backend write it caused were two unrelated lines
matched up by learner and timestamp — guesswork on a surface four children share.

---

## 2. What shipped

| Change | Commit |
|---|---|
| Card says three different things (breadcrumb / unit+day / the work) | `22a4a6c08` |
| One-unit course drops its meaningless "1 of 1" bar | `89b529bb0` |
| Household calendar validated once; wall and agenda cannot disagree | `4c6ee3d07` |
| Blue `exempt` squares for named days off, carrying their own name | `f35aca613` |
| A dimmed rung names the capability it actually lacks | `1798b64db`, `040730ed5` |
| Control row stops collapsing 70px mid-drill (and Recording's 46px) | `90549dbf7` |
| Play button cannot be pushed off the top of a short stage | `e5ca025b8` |
| Repetition holds a finished sentence; Next advances *and* plays | `e28091d19`, `ed18a86b9` |
| API layer instrumented; run id; launcher's zero events | `4853a2450` |
| Run id minted in the shell | `3913e61ad` |

Reference docs are in `docs/reference/school/` — `sentence-ladder.md` (card, units, blocked
rung, "Reading a session back"), `term-grid.md` (household calendar), `reading-sessions.md`
(the blue square).

---

## 3. What is NOT done

### 3a. The observability sweep is HALF done — I said otherwise, and I was wrong

`docs/_wip/plans/2026-09-09-sentence-ladder-outstanding.md` Task 8 has five steps. Steps 1, 2
and the backend half of 3 shipped. **The frontend transitions did not.**

| Still at zero / missing | Why it matters |
|---|---|
| `DeviceSettings.jsx` — **0 events** | A capability override is the most consequential thing a grown-up can do here, and it is what is currently dimming Dictation on the laptop. If someone toggles it tomorrow, nothing records it. |
| `PacingControl.jsx` — **0 events** | Daily limit changes are invisible. |
| tab switch, day-complete, gate refusal, blocked-rung shown, extra-practice banner | The interstitials are exactly where a confused child stalls. |
| Repetition's new states (held / replayed / advanced) | The feature added yesterday is unobservable; `RepetitionRung` still logs only `enter` and `complete`. |

This is the highest-value remaining work.

### 3b. Nothing has been watched running by a human

Eight tasks shipped and deployed on unit tests alone. **Task 6 was never executed.**

A disposable rig is ready and unused:
```
/app/school/go/kckern/sentence-ladder/glossika-korean-test
```
20 sentences, `lessonSize: 8` (2 new/day, 8 steps — finishable), units at seq 1 and 11 so the
unit line can be watched changing. Progress is keyed `(user, corpusId)`, so this cannot touch
the real Glossika record. Audio is shared from the real corpus's media folder.

Worth confirming by eye: the three card slots really do read as three different things; the
stage does not move between drill phases; Next both advances and plays; the blocked-rung note
names a keyboard rather than a microphone.

### 3c. Half the work shipped without review

Tasks 4, 1 and 2 each had spec review *and* quality review. Those reviews caught a false
performance claim, a live label inconsistency and a clipping trap — none of which the
implementers or I had spotted.

**Tasks 3, 5, 8a and the run-id wiring had no review at all.** Task 3 rewrote a state machine
and shipped on its author's self-report. The plan also calls for a final review across the
whole implementation; that did not happen either. If anything here misbehaves tomorrow, those
four commits are where I would look first.

---

## 4. Known-open, deliberately not fixed

- **Recording's review phase exceeds the control-row floor below ~664px stage width** — the
  audio element plus two buttons wrap, the row grows past 88px, and the sentence moves 26px on
  the `recording → review` transition. Measured, commented, not fixed. Same defect class as the
  bug that was fixed, one phase narrower.
- **`TypedRung`'s blocked alert** pushes content down when it appears. Judged correct — an alert
  is meant to grab attention, and reserving space for one that usually never fires costs more
  than it saves. A decision, not an oversight.
- **`$disc` is rem** while `$touch` / `$touch-min` / `$radius` beside it are px. Inherited. If
  root font size ever changes, the disc moves and the touch floors do not.
- **The frontend's `.filter(([, need]) => need)`** in `getDay` is dead in practice — every rung
  that can be blocked necessarily has a non-null requirement. One cheap clause, left alone.

---

## 5. Environment left dirty

- **The test rig is live on prod.** `data/content/school/language/glossika-korean-test.yml` and
  `data/household/school/plans/learners/kckern.yml`. That tree is Dropbox-synced, so both are
  deployed. Harmless — an adult is not on the school roster, so no board disc and no coins —
  but they are real files created for a test that was never run. Delete both plus
  `data/users/kckern/apps/school/language/glossika-korean-test/` when done.
- **A learner's plan file has a Dropbox "conflicted copy" sitting beside it** in
  `data/household/school/plans/learners/`. A stray plan file in that directory is exactly the
  kind of thing that gets read by accident. Spotted, never chased.
- `_deleteme/` holds a session of harnesses and screenshots — the SCSS jitter rig with
  before/after shots, the overflow-clipping prover, a conflict resolver. Gitignored.
- `docs/docs-last-updated.txt` is at `bd6cc3c4e`, roughly 40 commits behind.
- **The log store still has no Cloudflare Access token.** `CLAUDE.local.md` records this as a
  standing action item: one perimeter rule stands between the open internet and a live feed of
  the children's telemetry — and yesterday added a great deal more of it.

---

## 6. Three premises of mine that did not survive, so nobody repeats them

1. **"`namedDayOff` re-validates 28 times per summary, so passing a pre-validated schedule is a
   performance fix."** False. It validates unconditionally on entry, so the passes still happen
   — and measured, pre-normalized input is ~14% *slower* (0.14ms → 0.16ms, both noise). The
   change is a **consistency** fix and the commit body records the disproof with numbers so the
   next person does not re-derive it.
2. **"`overflow: auto` means the Typed rung degrades to a scroll rather than clipping."** False
   vertically. A scroll container only reaches content past its block-END edge, so with a
   centred rung anything above the origin is unreachable — `scrollTop = -9999` moves it zero
   pixels. The trap pre-existed; `safe center` now fixes it.
3. **"A corpus that cannot name its language degrades silently."** That case cannot occur —
   `validateCorpus` refuses such a corpus outright, and `corpus-invalid` already owns the fault
   more loudly. The proposed warn was dropped rather than shipped as an unreachable branch.

A fourth thing, from the tests rather than from me: **four tests in this module were pinning
wrong behaviour** — the hardcoded microphone string, a `'KR keyboard'` label, and two
auto-advance assertions (one of which would have passed vacuously). A green suite held those
defects in place. Passing is not the same as correct.

---

## 7. Git and deploy notes

The deploy tree at `{env.prod_host}:/opt/Code/DaylightStation` **diverged three times in one
day and rebased under this branch once**, so work merged in the afternoon reappeared under new
SHAs in the evening and the merge base collapsed to that morning. Resolve such a merge **by
content, not by ancestry or commit subject** — both lie after a rebase. In that merge, six
`School.scss` hunks had to be resolved *theirs*, because "mine" were only an older copy of
their own design work.

Deploy is documented in `docs/runbooks/eink-display-management.md` (§ "Reload / redeploy after
code changes") and is the procedure used here: pull on the prod host, `docker build` with
`BUILD_TIME`/`COMMIT_HASH` args, then `stop` / `rm` / `deploy-daylight`. Verify with
`docker exec ... cat /build.txt` — it stamps the commit, which is how you tell what is actually
running.

Also: the PII pre-push hook is present in the main checkout and works — it blocked a draft of
the plan doc over learner names. It is **absent inside `.claude/worktrees/*`**, so pushes made
from a worktree warn instead of scanning. Push from the main checkout.
