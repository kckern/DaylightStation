# Sentence Ladder — Outstanding Work Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three sentence-ladder UI defects, remove two duplications introduced by the
2026-09-09 calendar work, and get the whole branch verified and delivered.

**Architecture:** Three independent frontend fixes (a mislabelled note, a collapsing control
row, an auto-advance the child cannot interrupt), each fixed at its own layer — the note by
having the SERVER say which capability is missing rather than the client guessing, the row by
reserving the height it already needs, the advance by holding the completed sentence in the
parent until the child chooses. Then two cleanups and a delivery pass.

**Tech Stack:** Node 20 ESM (`.mjs` backend), React 18 (`.jsx`), Vitest, SCSS.

**Branch:** `school/print-card-metadata`, currently +17 vs `origin/main`, already merged with
the deploy tree at `45dc4e63b`.

**Run tests with:** `npx vitest run <path> -c vitest.config.mjs` for anything under `tests/`,
and `npx vitest run <path>` for anything under `backend/src` or `frontend/src`.
The full gate is `npm run test:backend` (~3 min, 10,973 tests).

---

## Context an engineer new to this code needs

**The ladder has four rungs** (`backend/src/2_domains/school/language/ladder.mjs`), and each
declares what the learner must be able to DO to answer it:

| Rung | Response | Requires |
|---|---|---|
| `repetition` | none | nothing — any device can run it |
| `dictation` | text, in the TARGET language | a keyboard that can type Korean |
| `recording` | audio | a microphone |
| `interpretation` | text, in the SOURCE language | a keyboard that can type English |

`requirementFor(rung, languages)` turns that into `{kind:'microphone'}` or
`{kind:'textInput', language:'KR'}`. `chainFor` drops any rung the device cannot answer, and
`missingCreditRungs` reports the ones the enrollment wanted but this device cannot climb.

**The bug that started this:** a card showed "Dictation — Needs a microphone". Dictation needs
a *keyboard*. The domain is correct; the note is a hardcoded string.

---

## Task 1: The blocked-rung note names the capability actually missing

The server already knows the answer (`requirementFor`); the client is guessing and guessing
wrong. Send the requirement alongside `missingCreditRungs` rather than duplicating the rung
table in the frontend.

**Files:**
- Modify: `backend/src/3_applications/school/LanguageStudyService.mjs:251-253`
- Test: `tests/isolated/application/school/programLaunchers.test.mjs`
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.jsx:316-328`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx`

### Step 1: Write the failing backend test

Add to `tests/isolated/application/school/programLaunchers.test.mjs`, inside the
`LanguageStudyService.todayStatus` describe or a new one for `day()` — check which helper the
file already uses to build a day before writing this; reuse it rather than inventing a second.

```js
it('says WHY each unclimbable rung is unclimbable, so a card need not guess', () => {
  // A device with a microphone but no Korean keyboard: dictation is out,
  // recording is fine. This is the live Portal case.
  const day = svc.day({
    userId: 'kckern', corpusId: 'test-korean',
    capabilities: { microphone: true, textInput: ['EN'] },
  });
  expect(day.missingCreditRungs).toContain('dictation');
  expect(day.missingCreditNeeds.dictation).toEqual({ kind: 'textInput', language: 'KR' });
  expect(day.missingCreditNeeds).not.toHaveProperty('recording');
});

it('names the microphone when THAT is what is missing', () => {
  const day = svc.day({
    userId: 'kckern', corpusId: 'test-korean',
    capabilities: { microphone: false, textInput: ['EN', 'KR'] },
  });
  expect(day.missingCreditNeeds.recording).toEqual({ kind: 'microphone' });
});
```

### Step 2: Run it and watch it fail

```bash
npx vitest run tests/isolated/application/school/programLaunchers.test.mjs -c vitest.config.mjs
```
Expected: FAIL — `day.missingCreditNeeds` is undefined.

### Step 3: Implement

In `LanguageStudyService.mjs`, the return block around line 251. `requirementFor` and
`rungById` are already imported at the top of the file — verify before adding an import.

```js
      missingCreditRungs: missing,
      // WHY each one is out of reach, so a card does not have to re-derive the
      // rung table. A client that guesses gets it wrong: the first version of
      // the ladder printed "Needs a microphone" on DICTATION, which needs a
      // keyboard. `requirementFor` is the one place that mapping lives.
      missingCreditNeeds: Object.fromEntries(
        missing.map((rung) => [rung, requirementFor(rungById(rung), corpus.languages)])
          .filter(([, need]) => need),
      ),
```

Hoist the existing `missingCreditRungs` expression into `const missing = ...` above the return
so it is computed once instead of twice.

### Step 4: Run the backend test — expect PASS

### Step 5: Write the failing frontend test

In `SentenceLadderProgram.test.jsx`. Model the day fixture on what the file already uses.

```js
it('names the capability a blocked rung actually needs, not always the microphone', async () => {
  dayMock.mockResolvedValue({ ok: true, data: {
    ...DAY, missingCreditRungs: ['dictation'],
    missingCreditNeeds: { dictation: { kind: 'textInput', language: 'KR' } },
  } });
  render(<SentenceLadderProgram userId="kckern" corpusId="test-korean" />);
  expect(await screen.findByText(/Korean keyboard/i)).toBeInTheDocument();
  expect(screen.queryByText(/microphone/i)).toBeNull();
});

it('still says microphone when the microphone is the thing missing', async () => {
  dayMock.mockResolvedValue({ ok: true, data: {
    ...DAY, missingCreditRungs: ['recording'],
    missingCreditNeeds: { recording: { kind: 'microphone' } },
  } });
  render(<SentenceLadderProgram userId="kckern" corpusId="test-korean" />);
  expect(await screen.findByText(/microphone/i)).toBeInTheDocument();
});
```

### Step 6: Run it and watch it fail

### Step 7: Implement the note

Add near `RUNG_LABELS` at the top of `SentenceLadderProgram.jsx`:

```js
/**
 * The corpus writes its own language codes (`EN`, `KR`) and they are not BCP-47,
 * so `Intl.DisplayNames` cannot name them. An explicit map, falling back to the
 * code itself — a card saying "Needs a KR keyboard" is poor, and a card
 * confidently saying the wrong language is worse.
 */
const LANGUAGE_NAMES = { EN: 'English', KR: 'Korean' };

/** What a rung this device cannot climb is actually short of. */
function needSentence(need) {
  if (need?.kind === 'microphone') return 'Needs a microphone — on another device';
  if (need?.kind === 'textInput') {
    const language = LANGUAGE_NAMES[need.language] ?? need.language;
    return `Needs a ${language} keyboard — on another device`;
  }
  // A rung the server could not explain still says something true: it is out of
  // reach here. Silence would leave a dimmed rung with no reason at all.
  return 'Not available on this device';
}
```

Then replace the hardcoded span (line ~324):

```jsx
                      <span className="lang-ladder__note">{needSentence(missingCreditNeeds[rung])}</span>
```

and read the map beside `missingCreditRungs` (~line 244):

```js
  const missingCreditNeeds = day?.missingCreditNeeds ?? {};
```

### Step 8: Run the frontend test — expect PASS

### Step 9: Commit

```bash
git add backend/src/3_applications/school/LanguageStudyService.mjs \
        tests/isolated/application/school/programLaunchers.test.mjs \
        frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.jsx \
        frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx
git commit -m "fix(school): a dimmed rung says what it actually needs

Dictation needs a keyboard and the card said microphone. The rung table
lives in one place (requirementFor); the client was keeping a second copy
of it in a hardcoded string, and that copy was wrong."
```

---

## Task 2: The control row stops collapsing

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadder.scss:301`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadder.scss` has no test;
  verify by screenshot (Step 3).

**The cause, confirmed by reading both files:** `.lang-rung__controls` has no height of its own.
Its three possible children are a **5.5rem** disc button (`.lang-btn--disc`, line 163) and two
one-line text spans (`&__status`, `&__saved`, line 297-299). So the row is 88px while playing
and ~19px the moment it becomes "Next…" or "Done" — a 69px collapse. `.lang-rung` is
`justify-content: center` (line 260), so the whole stage recentres and the sentences above
jump. That is the rugpull.

### Step 1: Reserve the height

Replace line 301:

```scss
  // HEIGHT IS RESERVED, NOT DISCOVERED. This row holds either a 5.5rem play
  // disc or a single line of text ("Next…", "Done"), and letting it size to
  // its content collapsed it by ~69px the instant a sentence finished. The
  // stage above is centred, so the sentences jumped every time — the drill
  // pulled the rug out from under the thing the child was reading. The disc is
  // the tallest thing that can live here, so the disc is the floor.
  &__controls {
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
    justify-content: center; margin-top: 0.5rem;
    min-height: 5.5rem;
  }
```

### Step 2: Check the disc size has not drifted

```bash
grep -n "width: 5.5rem; height: 5.5rem" frontend/src/modules/School/Programs/SentenceLadder/SentenceLadder.scss
```
Expected: one hit, `.lang-btn--disc`. If it differs, match `min-height` to it.
Better still, extract a `$disc: 5.5rem` variable beside the other size variables at the top of
the file and use it in both places, so they cannot drift apart.

### Step 3: Verify the SCSS compiles and see it

```bash
npm run check:scss
```
Expected: `SCSS build gate OK`.

Then look at it, do not assume: run the app (@run skill) or screenshot the three states
(playing / "Next…" / "Done") and confirm the sentences above do not move between them.

### Step 4: Commit

---

## Task 3: Repetition offers repeat-or-move-on instead of auto-advancing

**Files:**
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/rungs/RepetitionRung.jsx`
- Modify: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.jsx:401-409`
- Test: `frontend/src/modules/School/Programs/SentenceLadder/SentenceLadderProgram.test.jsx`

**How it works today, and why a local fix is not enough.** `RepetitionRung` fires `onComplete`
in `handleEnd`; the parent saves, re-fetches, and `pending[0]` becomes the NEXT sentence, so
`key={`${entry.rung}-${entry.seq}`}` remounts the component on a new sentence. The child never
gets a chance to repeat the one they just heard — the data moved on. A 350ms `autoStart`
timer (line ~76) then plays it automatically.

So the hold has to live in the PARENT: the completed sentence stays on screen until the child
chooses. Removing only the timer would leave the sentence swapping out silently, which is worse.

### Step 1: Write the failing test

```js
it('holds a finished repetition on screen instead of running on to the next', async () => {
  // Two repetition sentences; finishing the first must not present the second.
  renderWithDay({ queue: [entry(1, 'repetition'), entry(2, 'repetition')] });
  fireEvent.click(await screen.findByRole('button', { name: /play/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /play again/i })).toBeInTheDocument();
  // Still sentence one.
  expect(screen.getByText(SENTENCE_ONE_TEXT)).toBeInTheDocument();
});

it('moves on only when the child says so', async () => {
  renderWithDay({ queue: [entry(1, 'repetition'), entry(2, 'repetition')] });
  fireEvent.click(await screen.findByRole('button', { name: /play/i }));
  fireEvent.click(await screen.findByRole('button', { name: /next/i }));
  expect(await screen.findByText(SENTENCE_TWO_TEXT)).toBeInTheDocument();
});

it('replays the same sentence without recording a second pass', async () => {
  const { onCompleteCalls } = renderWithDay({ queue: [entry(1, 'repetition')] });
  fireEvent.click(await screen.findByRole('button', { name: /play/i }));
  fireEvent.click(await screen.findByRole('button', { name: /play again/i }));
  // The rung was already credited; hearing it again is not a second climb.
  expect(onCompleteCalls()).toBe(1);
});
```

You will need an audio stub that ends the sequence synchronously — check how the existing
tests in this file drive `useSentenceAudio` and reuse that, do not invent a second stub.

### Step 2: Run and watch it fail

### Step 3: Implement — the parent holds

In `SentenceLadderProgram.jsx`, beside the other state (line ~46):

```js
  // The sentence a child has finished but not yet left. Repetition is the one
  // rung with nothing to submit, so "done" used to mean "gone" — the next
  // sentence replaced it 350ms later and the one they had just heard could not
  // be heard again. Holding it is what turns a conveyor belt into a choice.
  const [heldSeq, setHeldSeq] = useState(null);
```

Where `entry` is chosen (~line 139), prefer the held one:

```js
  const held = heldSeq == null ? null : group?.items.find((i) => i.seq === heldSeq) ?? null;
  const entry = held ?? pending[0] ?? null;
```

Clear the hold whenever the rung or day changes, or a held sentence stops existing — a stale
hold would pin a sentence that is no longer in the queue:

```js
  useEffect(() => { setHeldSeq(null); }, [activeRung, day?.day]);
```

Pass it down (line ~406), replacing `autoStart={armed}`:

```jsx
            held={heldSeq === entry.seq}
            onHold={() => setHeldSeq(entry.seq)}
            onAdvance={() => setHeldSeq(null)}
```

### Step 4: Implement — the rung offers the choice

In `RepetitionRung.jsx`:

1. **Delete the auto-start effect** (the `window.setTimeout(start, 350)` block, ~line 74-79)
   and the `autoStart` prop with it. Delete `halted` only if nothing else uses it — the
   blocked-audio effect does, so keep it.
2. In `handleEnd`, after a successful save, call `onHold()`.
3. Replace the `phase === 'done'` span with the two controls:

```jsx
        {phase === 'done' && (
          <>
            <button
              type="button"
              className="lang-btn lang-btn--disc lang-btn--disc-quiet"
              onClick={() => { setPhase('idle'); setHalted(false); start(); }}
            >
              <Icon name="restart" className="lang-btn__glyph" />
              <span className="lang-btn__word">Play again</span>
            </button>
            <button type="button" className="lang-btn lang-btn--primary" onClick={onAdvance}>
              Next
            </button>
            <span className="lang-rung__saved">{saving ? 'Saving…' : 'Done'}</span>
          </>
        )}
```

**Play again must not re-credit the rung.** `handleEnd` calls `onComplete`; a replay that runs
it again would log a second pass for a sentence already climbed. Guard it with a ref:

```js
  const credited = useRef(false);
  useEffect(() => { credited.current = false; }, [entry.seq]);
```

and in `handleEnd`, `if (credited.current) { setPhase('done'); return; } credited.current = true;`
before calling `onComplete`.

Confirm `restart` exists in the icon set before using it:
```bash
ls frontend/src/modules/School/home/icons/svg/restart.svg
```

### Step 5: Run the tests — expect PASS

### Step 6: Check nothing else passed `autoStart`

```bash
grep -rn "autoStart" frontend/src | grep -v node_modules
```
Expected: no hits outside the files you just edited.

### Step 7: Commit

---

## Task 4: One household calendar read, not twenty-nine

**Files:**
- Modify: `backend/src/app.mjs:4837`
- Modify: `backend/src/3_applications/school/ReadingApiService.mjs` (constructor + streak)
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (export `householdSchedule`)
- Test: `tests/isolated/api/routers/reading.test.mjs`

**The problem I introduced:** `ReadingApiService` takes raw `schoolFullConfig.calendar` and
calls `namedDayOff(day, raw)`, which runs `validateSchedule` **once per day across a 28-day
window** — 28 validations per summary, on a screen a child opens all day. Meanwhile
`schoolLifecycle.mjs:800` already validates the same config once, as `householdSchedule`, and
feeds it to the agenda and the term grid.

### Step 1: Make the validated schedule reachable

Check whether `schoolLifecycle` already returns `householdSchedule` on its public object
(it is used internally at lines 807 and 863). If not, add it to the returned object.

### Step 2: Pass the validated one

`app.mjs:4837` becomes:

```js
      householdCalendar: schoolLifecycle.householdSchedule ?? null,
```

### Step 3: Validate once, not per day

In `ReadingApiService#summary`, hoist above the `days.map`:

```js
      // Validated ONCE. `namedDayOff` re-validates whatever it is handed, and
      // this window is 28 days long — a screen a child opens all day should not
      // pay 28 schema validations for one answer.
      const calendar = this.#householdCalendar;
```

`namedDayOff` still validates internally (it must — it is a pure domain function with no
trusted caller), so the win here is passing an already-normalized object. If profiling shows
that is still hot, add a `namedDayOffIn(normalizedSchedule, day)` variant; do not do it
speculatively.

### Step 4: Run the reading tests — expect the existing 36 to still pass

```bash
npx vitest run tests/isolated/api/routers/reading.test.mjs -c vitest.config.mjs
```

### Step 5: Commit

---

## Task 5: Documentation

**Files:**
- Modify: `docs/reference/school/agenda-and-completion.md`
- Modify: `docs/_wip/plans/2026-09-09-language-ladder-card-metadata.md`

### Step 1: Document the calendar label and the `exempt` square

Add to `agenda-and-completion.md`, near the existing streak material:

- `except` spans take an optional `label`; a labelled span is a NAMED day off.
- `namedDayOff()` follows `scheduleVerdict` precedence exactly — `also` wins, so a makeup
  Saturday inside a vacation is a school day and not a holiday; a weekend is nobody's `except`.
- The reading streak now emits `exempt` (blue, `DayGrid`'s existing state, shared with the term
  grid) for a named day off, and carries the name so the square can say "Thanksgiving" rather
  than "a day off".
- Reading on a holiday still counts: `met`/`partial` are checked first.
- The household calendar is populated for Fall 2026 in `school.yml`.

### Step 2: Close out the design doc's open question

The poster hosting was left as an open decision with two options. Option 2 was built:
`program:<id>:<instance>` in the course-id scheme, served from
`<media>/school/programs/<programId>/<instanceId>/poster.jpg`. Record that and delete the
"decide before implementing" note.

### Step 3: Commit

---

## Task 6: Verification — see it running

Nothing in this branch has been seen in the live app; it is all unit-tested only.

**Read `CLAUDE.local.md` first.** There is a hard rule: **never start a second backend.**
`node backend/index.js` is a live household controller — a second instance makes real Home
Assistant calls and fights the running one for device authority, on any port. Stop the existing
dev server and run ONE stack, or use the already-running one.

**Config is cached at startup.** The enrollment `units` (both enrolled learners) and the household
`calendar` are on disk but not live until a restart or a `reloadHouseholdAppConfig` call.

### Step 1: Get one stack running (see @run)

### Step 2: Check the four things this branch changed

1. A Glossika agenda card: breadcrumb reads `Language › Glossika Korean`, the `■` line reads
   `Fluency 1 · Day N`, the title is the work (`N sentences today`), one TODAY bar. Three
   different strings — the whole point.
2. The poster actually loads:
   `curl -sI http://localhost:<port>/api/v1/school/self-service/programs/sentence-ladder/glossika-korean/poster.jpg`
   Expected: `200` and `Content-Type: image/jpeg`. A 404 means the id or the path is wrong.
3. The reading streak shows blue squares on the term's holidays.
4. The three ladder fixes above.

### Step 3: Record what you saw

Screenshot the card and the wall. If something is wrong, that is a finding — fix it here
rather than shipping on green unit tests alone.

---

## Task 7: Delivery

### Step 1: Know where the PII guard does and does not run

`.claude/secret-patterns.local.txt` IS present in the main checkout and the hook works — it
blocked a commit while this plan was being written, for the learner names in the line above.

It is absent inside `.claude/worktrees/*`, which is why the two pushes made from a worktree on
2026-09-09 warned instead of scanning. Push from the main checkout, or copy the file into the
worktree first. Never treat the warning as a pass: the branch touches school data and learner
ids, and a guard that exists but did not run is the worst of both.

### Step 2: Run the full gate

```bash
npm run test:backend
```
Expected: `Test Files 851 passed`, `Tests 10973 passed`, no unhandled errors.

### Step 3: Re-check the deploy tree BEFORE pushing

It has moved twice today. Per `CLAUDE.local.md`:

```bash
git fetch homeserver.local:/opt/Code/DaylightStation main:refs/deploy/main --force
git log --oneline HEAD..refs/deploy/main
```
If it is ahead again, merge before pushing — do not push over it.

### Step 4: Push

```bash
git push origin HEAD:main
```
A plain push refuses a non-fast-forward, which is the guard you want. Never `--force`.

### Step 5: Clean up

- Empty `_deleteme/` (it holds `wallShot.mjs` and a stray test file).
- Record the branch in `docs/_archive/deleted-branches.md`, then delete it.
  `git branch -d` compares against the CURRENT HEAD, not main — verify with
  `git merge-base --is-ancestor <branch> origin/main` before using `-D`.

---

## Not in this plan, on purpose

**The stale capability override.** A stored override on KC's Mac (`textInput: ["EN"]`, from
before School had a Hangul composer) is what actually dims Dictation there — not a code
defect. `canCompose('KR')` is already true, so clearing the override in Device Settings
unblocks the rung with no code change. Task 1 makes the *message* honest; it does not and
should not change what the device is capable of.

**The Portal microphone.** Unverifiable from here. FKB reports `microphoneAccess = true`, but
no Portal client has opened the ladder in 30 days of logs, and the mic is gated behind a
hardware privacy switch wired into Portal's HAL whose state needs a Facebook signature
permission to read (`_extensions/portal-keys/README.md`). Confirming it needs someone standing
at the panel. Do not write code that assumes either answer.
