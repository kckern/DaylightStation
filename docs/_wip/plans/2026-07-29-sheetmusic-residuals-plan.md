# Sheet-Music Wave-3 Residuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every code residual accepted at the wave-3 merge (`docs/_wip/plans/2026-07-29-sheetmusic-wave3-followups.md`, "Code follow-ups" section) — bug fixes, dead-code deletion, mutant-killing tests, stale comments — leaving the followups doc holding only the on-device checklist and the two genuinely deferred items.

**Architecture:** Twelve small, independently committable tasks. Tasks 2–7 all edit `ScorePlayer.jsx` and MUST run in order; the rest are independent. No behavior redesign anywhere — each fix restores an already-documented invariant (guarded panic, honest cycle tally, completion-gated banking UI) or deletes code proven unreachable.

**Tech Stack:** React 18 (frontend), vitest 4 + @testing-library/react (colocated `*.test.js(x)`), structured logging via `frontend/src/lib/logging/`.

## Global Constraints

- **Workspace:** `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3` (a git worktree, currently detached at origin/main). Before Task 1, create a branch: `git checkout -b sheetmusic-residuals`. All paths below are relative to this worktree root.
- **Test command (verified working):** from the worktree root, `node_modules/.bin/vitest run <path> --reporter=dot`. The worktree's root `node_modules` is a symlink to the main checkout's. NEVER run these tests from the main checkout — its config excludes `**/.claude/worktrees/**`. vitest 4 rejects `--reporter=basic`; use `dot`.
- **Sheet-music module root** (referenced as `SheetMusic/` below): `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`.
- **Logging:** never raw `console.*`; use the existing `logger`/`log` child loggers already in each file.
- **Composer note-type strings:** the canonical sixteenth-note type string is `'16th'` (NOT `'sixteenth'`) — mismatches throw in the serializer.
- **Comments:** these files carry dense, invariant-explaining comments. New comments must state the constraint (why the code must be this way), not narrate the change.
- **Commit per task**, message given in each task's final step. Do not deploy; integration is a separate decision at the end (superpowers:finishing-a-development-branch).

**Explicitly out of scope** (stay in the followups doc):
- The on-device verification checklist (needs the physical piano/tablet).
- The real chord-grouping feature (blocked on `composer.input.chord-decision` field data).
- The "composer duration classes change the numpad UX" product sign-off (a decision, not code).

---

### Task 1: `usePracticeRecord` — a null user must still load

`currentUser === null` (roster still fetching, or fetch permanently failed) leaves `loaded` false forever, so Learn's auto-range (`ScorePlayer.jsx:1486` gates on `practiceLoaded`) never lands. Guest already gets `loaded: true`; null must too — both are non-persistent, history-less users. When the roster later resolves, the effect re-runs on the `currentUser` change and loads the real record.

**Files:**
- Modify: `SheetMusic/usePracticeRecord.js:24-28`
- Test: `SheetMusic/usePracticeRecord.test.js`

**Interfaces:**
- Consumes: `isPersistentUser(id)` from `frontend/src/modules/Piano/PianoKiosk/pianoUser.js` (`(id) => !!id && id !== GUEST_PROFILE.id` — already handles null).
- Produces: no API change; `loaded` becomes true for ALL non-persistent users.

- [ ] **Step 1: Write the failing test**

In `SheetMusic/usePracticeRecord.test.js`, after the guest test (ends line 55), add (the file's harness: `calls`, `store`, `mockUser`, `FP` are module-level, reset in `beforeEach`):

```js
  it('a null user (roster pending or failed) runs history-less but LOADED — Learn auto-range must not wait on the roster', async () => {
    mockUser = null;
    const { result } = renderHook(() => usePracticeRecord({ scoreId: 'files:x.musicxml', fingerprint: FP }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(calls).toHaveLength(0); // no GET for a non-persistent user
    expect(result.current.persistent).toBe(false);
    expect(result.current.record).toEqual({});
  });
```

- [ ] **Step 2: Run it — verify it fails**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js --reporter=dot`
Expected: the new test FAILS (the `waitFor` on `loaded` times out); all others pass.

- [ ] **Step 3: Fix the hook**

In `SheetMusic/usePracticeRecord.js`, the load effect currently reads:

```js
    setRecord({}); setLoaded(false);
    if (!isPersistentUser(currentUser)) {
      setLoaded(currentUser === GUEST_PROFILE.id);
      return undefined;
    }
```

Change to:

```js
    setRecord({}); setLoaded(false);
    if (!isPersistentUser(currentUser)) {
      // Guest AND null (roster pending/failed) both run history-less but LOADED —
      // a false `loaded` here parks Learn's auto-range forever (it gates on it).
      // When a pending roster resolves, `currentUser` changes and this re-runs.
      setLoaded(true);
      return undefined;
    }
```

Then check whether `GUEST_PROFILE` is still referenced anywhere else in the file (grep within the file); if that was its only use, remove it from the import. `isPersistentUser` stays.

- [ ] **Step 4: Run the whole test file — verify green**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js --reporter=dot`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js
git commit -m "fix(piano): a null user loads history-less — Learn auto-range no longer waits on the roster"
```

---

### Task 2: Delete the dead transport loop machinery, harden the retired-L6 test

Wave-3 §0 made loop/focus Learn-only (`range` is non-null only when `mode === 'learn'`, `ScorePlayer.jsx:314-317`), and Learn's gate runs the transport with an EMPTY timeline (line ~468). So both transport wrap paths — the `onEvent` step-wrap and the `onDone` restart branch — require a non-null `r = rangeRef.current` in a mode that can never have one. They are doubly dead, and they drag `loopWraps` (permanently 0) and the wrap-dwell timer with them. Delete all of it. The retired-L6 regression test that guards this area is also missing its positive anchor (all its assertions are negatives) — fix that here since its comments must change anyway.

**Files:**
- Modify: `SheetMusic/ScorePlayer.jsx` (state ~219-221, dwell refs ~437-442, onEvent ~488-503, onDone ~522-557, evaluator ~804, comments ~263-269 and ~1768, plus 8 `clearWrapDwell()` call sites)
- Modify: `SheetMusic/ScorePlayer.test.jsx:2374-2439` (retired-L6 test)

**Interfaces:**
- Consumes: `useScoreEvaluator`'s `boundary` param has default `0` (`useScoreEvaluator.js:37`) — dropping the prop is behavior-preserving. Do NOT edit the hook itself; `boundary` is its documented generic API.
- Produces: `loopWraps`, `setLoopWraps`, `wrapTimerRef`, `clearWrapDwell` and the log event `score.transport.loop-wrap` cease to exist in ScorePlayer.

- [ ] **Step 1: Add the positive anchor to the retired-L6 test (it must pass before AND after the deletion)**

In `ScorePlayer.test.jsx`, the test `'a tail-measure range in Listen arms no wrap dwell at all — nothing restarts itself (L6, retired)'` clears the note spy without ever proving playback happened:

```js
    act(() => vi.advanceTimersByTime(200)); // where wave-2 armed the zero-span dwell
    expect(wraps()).toEqual([]);            // …nothing is armed: Listen holds no range
    h.sendNoteAt.mockClear();
```

Insert the anchor before the clear:

```js
    act(() => vi.advanceTimersByTime(200)); // where wave-2 armed the zero-span dwell
    expect(wraps()).toEqual([]);            // …nothing is armed: Listen holds no range
    expect(h.sendNoteAt).toHaveBeenCalled(); // the run really sounded — every later
    h.sendNoteAt.mockClear();                // "nothing happened" assertion is non-vacuous
```

- [ ] **Step 2: Run the test — verify it still passes (anchor is satisfiable)**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot -t "L6, retired"`
Expected: PASS. If it fails, the run genuinely never sounded — STOP and investigate before deleting anything (the deletion's safety argument depends on understanding this test).

- [ ] **Step 3: Delete the dead code in ScorePlayer.jsx**

All in `SheetMusic/ScorePlayer.jsx`:

1. **`loopWraps` state (~219-221):** delete the comment and the line `const [loopWraps, setLoopWraps] = useState(0);`
2. **Wrap-dwell refs (~437-442):** delete the comment block, `const wrapTimerRef = useRef(null);` and `const clearWrapDwell = useCallback(...)`.
3. **`onEvent` wrap branch (~488-503):** inside `onEvent`, delete the whole `const r = rangeRef.current; if (r && e.index > r[1]) { ... return; }` block AND its four-line comment ("Focus loop (at tempo)…"). Keep the rest of `onEvent`.
4. **`onDone` loop branch (~522-557):** delete from the leading comment ("A loop that contains the FINAL step…") through the closing `return;` of `if (r && (mode === 'listen' || mode === 'polish')) { ... }` — including the `restart` closure, the zero-span dwell, and the `score.transport.loop-wrap` log.
5. **Evaluator (~804):** delete the line `boundary: loopWraps,` (the hook defaults to 0; the comment above `loopWraps`' declaration was already removed in 1).
6. **`clearWrapDwell()` call sites:** grep `clearWrapDwell` and delete every call plus its trailing comment where the comment only describes the dwell (sites ~666 `stopForMatrixChange`, ~1362, ~1394, ~1404 focus effect, ~1536 `onMode`, ~1613 `pauseForRebuild`, ~1649 `reset`, ~1749). Remove `clearWrapDwell` from every affected `useCallback`/`useEffect` dependency array. In the focus effect (~1403) the comment `// a loop change (set/clear/nudge) invalidates a pending dwell` goes with it.
7. **Stale prose:** in the `runActive` doc comment (~263-269), delete the sentence(s) claiming a Polish loop restarts through onDone's one-beat dwell; in `toggleRun` (~1768) fix `reset()/onDone stop the transport first` if it references the removed restart path (read it; keep whatever is still true).
8. **Verify:** `grep -n "loopWraps\|wrapTimerRef\|clearWrapDwell\|loop-wrap" frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` → zero hits.

- [ ] **Step 4: Update the retired-L6 test's comment**

Its describe/it comments state that "onDone's loop branch logs `score.transport.loop-wrap` every time it runs … and here it must never run." Rewrite to reflect the endstate, e.g.: "The transport loop branch is deleted outright (wave-3 residuals): `range` is Learn-only and Learn's gate runs an empty timeline, so no transport wrap can exist. This test survives as the regression guard — nothing may restart itself after a tail-measure run in Listen." Keep the `wraps()` assertions (they now guard against reintroduction).

- [ ] **Step 5: Run the full ScorePlayer suite**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ --reporter=dot`
Expected: PASS. Any failure names a live consumer the deletion missed — investigate, don't force.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "chore(piano): delete the dead transport loop branch (loopWraps, wrap dwell) + anchor the retired-L6 test"
```

---

### Task 3: Learn cycle refs reset on loop toggle and Restart

`cycleWrongsRef`/`cycleVoidRef` are reset on wrap, focus change, and mode exit — but NOT on a loop OFF→ON toggle (`onToggleLoop`, ~1735: `focus` unchanged, so the focus effect never runs) or on Restart (`reset`, ~1645). Wrongs from an abandoned gate session leak into the next one's first wrap (stingy-only: denies passes, never grants). Both are session-ending actions, so both get the mode-exit treatment: DISCARD (reset), not void — voiding would silently raise the pass bar (same reasoning as the fresh-arm rule at ~1403-1412).

**Files:**
- Modify: `SheetMusic/ScorePlayer.jsx` (`onToggleLoop` ~1735, `reset` ~1645)
- Test: `SheetMusic/ScorePlayer.test.jsx` (Task-13 describe block, after the existing voider tests ~line 700)

**Interfaces:**
- Consumes: test helpers already in the file: `renderPlayer`, `h.layoutExtras`, `TWO_MEASURE_LEARN`, `selectFullRange()`, `settleCycle()`, `playFullPass()`, `play(midi)`, `toggleLoop()`, `enterLearnGate(x)`, `h.recordCycle`. NOTE `canRestart = running || step > 0 || grades` (ScorePlayer.jsx:2076) — the Restart test must advance the cursor off step 0 first or the button is disabled.
- Produces: no API change.

- [ ] **Step 1: Write the two failing tests**

In `ScorePlayer.test.jsx`, inside `describe('ScorePlayer — Learn cycle instrumentation feeds the practice record (Task 13)')`, after the hand-toggle voider test:

```js
  it('a loop OFF→ON toggle discards wrongs from the dead gate session — the new session\'s first clean pass counts clean', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    settleCycle();
    play(63);       // a wrong lands mid-cycle (cursor on measure 0)
    toggleLoop();   // gate OFF — the partial cycle dies with its session
    toggleLoop();   // gate back ON at the in-point — a fresh session
    playFullPass(); // clean pass
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(), // the pre-toggle wrong did NOT leak in
      bucket: 'both',
    });
  });

  it('Restart mid-cycle discards accumulated wrongs — the pass after Restart can be clean', () => {
    h.layoutExtras = TWO_MEASURE_LEARN;
    renderPlayer();
    selectFullRange();
    settleCycle();
    play(64); // satisfies step 0 → cursor to step 1 (Restart needs step > 0 to enable)
    play(63); // a wrong against step 1 → measure 1 tainted in the abandoned pass
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Restart' })); });
    playFullPass(); // a clean pass from the in-point
    expect(h.recordCycle).toHaveBeenCalledTimes(1);
    expect(h.recordCycle).toHaveBeenCalledWith({
      measureIndices: [0, 1],
      wrongMeasures: new Set(), // the pre-Restart wrong did NOT leak in
      bucket: 'both',
    });
  });
```

- [ ] **Step 2: Run them — verify both fail on `wrongMeasures`**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot -t "discards"`
Expected: both FAIL with `wrongMeasures: Set { 0 }` (first test) / `Set { 1 }` (second) instead of the empty set. If a test fails differently (e.g. `recordCycle` not called at all), fix the TEST until the failure is exactly the leak — the fixture/helpers are proven by the neighboring tests.

- [ ] **Step 3: Implement the resets**

In `onToggleLoop` (~1735), after `stopForMatrixChange();`:

```js
    stopForMatrixChange();
    // The gate session the current cycle belonged to ends with the toggle (OFF
    // kills the gate; ON re-enters at the in-point). DISCARD the partial cycle
    // outright — mode-exit semantics, not a void: stale wrongs would otherwise
    // poison the first wrap of the NEW session, and a void would silently raise
    // the pass bar on a session that never had a prior cycle to disrupt.
    cycleVoidRef.current = false;
    cycleWrongsRef.current = new Set();
```

In `reset` (~1645), after `setLearnDone(false);`:

```js
    setLearnDone(false);    // fresh pass — close the completion card
    // Restart abandons the in-progress pass and returns to the in-point: the next
    // wrap is a fresh cycle, and wrongs from the abandoned pass must not count
    // against it (discard, same as a mode exit).
    cycleVoidRef.current = false;
    cycleWrongsRef.current = new Set();
```

(Both refs are stable; no dependency-array changes needed.)

- [ ] **Step 4: Run the Task-13 describe + full file**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS, including all pre-existing voider tests (the void-vs-discard distinction must not regress).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano): loop toggle and Restart discard the partial Learn cycle — stale wrongs no longer deny passes"
```

---

### Task 4: Guard `silenceScheduled` in `onMode` and `pauseForRebuild`

`silenceScheduled()` (~443) arms a delayed CC123 panic unconditionally. `stopForMatrixChange` (~664) already guards it correctly; `onMode` (~1548) and `pauseForRebuild` (~1620) do not — so entering a mode, or a zoom/transpose during a SILENT Polish run, panics a piano the kiosk never played through while the player is holding keys. Apply the established guard.

**Files:**
- Modify: `SheetMusic/ScorePlayer.jsx` (`onMode` ~1536-1548, `pauseForRebuild` ~1612-1625)
- Test: `SheetMusic/ScorePlayer.test.jsx` (silent-matrix-change describe ~2701, tiers describe for the Polish case)

**Interfaces:**
- Consumes: `soundingRef` (ledger of kiosk-sent notes), `sendsAudio` (`mode === 'listen' || machineLearn`, ~335), `silence()` (self-guarded, ~420), the guard shape from `stopForMatrixChange`: `if (hadSound || (sendsAudio && wasPlaying)) silenceScheduled(); else silence();`
- Produces: mode entry / silent-run rebuild send no panic when nothing kiosk-sent is sounding.

- [ ] **Step 1: Write the failing tests**

In the silent-matrix-change describe block (`ScorePlayer.test.jsx` ~2701 — the one with `settleInSilentLearn`), add:

```js
  it('entering a mode on a silent kiosk sends no panic — held piano keys survive a mode switch', async () => {
    h.layoutExtras = THREE;
    await enterLearnFresh();               // a mode change with nothing sounding
    act(() => vi.advanceTimersByTime(1000)); // well past lookahead + 60ms
    expect(h.sendPanic).not.toHaveBeenCalled();
  });
```

In the Polish tiers describe (the one defining `tierFixture`/`pickTempo`/`pressPlay`, ~1440), add:

```js
  it('a transpose during a silent Polish run sends no panic — Polish never sounds through the kiosk', async () => {
    h.layoutExtras = tierFixture(3, 1);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS)); // run active, transport ticking silently
    h.sendPanic.mockClear();                        // drain anything the entry path sent
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Key' })); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: /\+1/ })); }); // → pauseForRebuild('transpose')
    act(() => vi.advanceTimersByTime(1000));
    expect(h.sendPanic).not.toHaveBeenCalled();
  });
```

(If Polish's transport bar turns out not to render the Key control, trigger `pauseForRebuild` through the zoom control instead — `onScaleStep` routes through the same `pauseForViewChange`; the assertion is identical.)

- [ ] **Step 2: Run them — verify both fail (panic IS sent today)**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot -t "no panic"`
Expected: the two new tests FAIL (`sendPanic` called); every pre-existing "no panic" test still passes.

- [ ] **Step 3: Implement both guards**

`onMode` — the block currently reading (~1542-1548):

```js
    transport.stop();
    setRunActive(false);         // …and so does the run itself (see runActive)
    ...
    runEligibleRef.current = false;
    silenceScheduled();
```

becomes (capture BEFORE `transport.stop()`; keep the intervening comment lines as they are):

```js
    const hadSound = soundingRef.current.size > 0;
    const wasPlaying = !!transportRef.current?.playing;
    transport.stop();
    setRunActive(false);         // …and so does the run itself (see runActive)
    ...
    runEligibleRef.current = false;
    // Same guard as stopForMatrixChange: silenceScheduled() arms a delayed CC123
    // unconditionally, and a silent mode switch (e.g. leaving Learn's gate while
    // holding keys) must not cut the PLAYER's notes. Flush only when the kiosk
    // itself was sounding; silence() self-guards on the ledger.
    if (hadSound || (sendsAudio && wasPlaying)) silenceScheduled(); else silence();
```

`pauseForRebuild` — replace the bare `silenceScheduled();` (after `setRunActive(false);`):

```js
    setRunActive(false);
    // Polish runs a SILENT step timeline — a mid-run view change (zoom/flow/
    // transpose) must not panic a piano the kiosk never played through while
    // the player is holding keys. Only the audio plane needs the delayed flush.
    if (sendsAudio || soundingRef.current.size) silenceScheduled(); else silence();
```

Add `silence` (and `sendsAudio` where newly read) to both callbacks' dependency arrays.

- [ ] **Step 4: Reconcile the suite's known-unconditional documentation**

The comments at ~2701-2706 ("silenceScheduled() arms a delayed CC123 unconditionally…") and ~2715-2716 ("Entering a mode flushes unconditionally (onMode, pre-existing) — let that delayed panic land…") describe the pre-fix world. Update: the matrix-change describe's intro should say the guard now covers `stopForMatrixChange`, `onMode` AND `pauseForRebuild`; `settleInSilentLearn`'s drain step becomes a plain "settle" (keep the `mockClear()` — harmless and it isolates the assertion). Then check `-t "flushes"`: the audible-path tests (~2748 "matrix change during AUDIBLE machine playback still flushes, twice", ~2292 view-change-during-Listen) MUST still pass — they prove the guard doesn't over-suppress.

- [ ] **Step 5: Run the full file**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS. A failure in any audible-flush test means the guard is wrong — fix the guard, not the test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano): mode entry and silent-run rebuilds no longer panic held piano notes"
```

---

### Task 5: Gate the `--current` tier highlight on a completed run

`RunSummary` marks a tier cell `--current` whenever `!mixedTempo && t === tier` — so a manual pause or silent-stop (partial run, banks nothing) still lights a column, implying that run belongs there. Thread the completion fact through the run snapshot and gate on it.

**Files:**
- Modify: `SheetMusic/ScorePlayer.jsx` (`openRunSummary` ~767-791, onDone call ~569, RunSummary render ~2115-2130)
- Modify: `SheetMusic/RunSummary.jsx` (props + highlight predicate ~51-54, ~100; JSDoc ~40-50)
- Test: `SheetMusic/RunSummary.test.jsx`, `SheetMusic/ScorePlayer.test.jsx`

**Interfaces:**
- Consumes: `runEligibleRef` (whole-piece claim, §H), `openRunSummaryRef.current?.(finalizeRef.current?.(endMeasure))` (onDone), `openRunSummaryRef.current?.(finalizeRef.current?.())` (toggleRun pause ~1758), `openRunSummary(g)` (onSilentStop ~799).
- Produces: `openRunSummary(extra, { completed = false } = {})`; the run snapshot gains `completed: boolean`; `RunSummary` gains prop `completed = false`.

- [ ] **Step 1: Write the failing tests**

`RunSummary.test.jsx` — in the "Polish tempo tiers (wave-3 H)" section:

```js
  it('a partial run (pause / silent-stop) marks NO tier cell — it banked nothing and belongs to no column', () => {
    render(<RunSummary open grades={grades} measures={measures} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={87} tier="medium" bucket="both" mixedTempo={false} completed={false}
      tierBests={{ slow: 78, medium: 84, full: null, overclocked: null }} />);
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(0);
  });
```

Also add `completed` to the existing completed-run test (`'shows the run score with tier and the four tier bests'`, ~42-54): its render call gains `completed` (bare prop = true) — it simulates a completed run and must keep its one `--current`.

`ScorePlayer.test.jsx` — in the Polish tiers describe:

```js
  it('a manual pause opens the summary with no current-tier highlight — a partial run belongs to no column', async () => {
    h.layoutExtras = tierFixture(3, 0.8);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    pickTempo('80%');
    await pressPlay();
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000)); // one measure graded — a real partial run
    screen.getByRole('button', { name: 'Pause' }).click(); // → toggleRun's finalize+open path
    await act(async () => {});
    expect(document.querySelector('.piano-score-run-summary')).not.toBeNull();
    expect(document.querySelectorAll('.piano-score-run-tier--current').length).toBe(0);
  });
```

- [ ] **Step 2: Run — verify the two new tests fail (a `--current` renders today)**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RunSummary.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot -t "partial run"`
Expected: both FAIL finding 1 `--current` where 0 is expected.

- [ ] **Step 3: Implement**

`ScorePlayer.jsx` `openRunSummary`:

```js
  const openRunSummary = useCallback((extra, { completed = false } = {}) => {
```

and the snapshot line:

```js
    const run = { grades: all, tier, mixed, base, completed, score: displayScore(base, tier) };
```

Extend the block comment above it (the `RETURNS the run snapshot` doc): add a line — `// \`completed\` carries the caller's whole-piece claim (onDone + runEligibleRef); pause and silent-stop leave it false, and the summary's tier highlight gates on it.`

onDone call (~569):

```js
        const run = openRunSummaryRef.current?.(finalizeRef.current?.(endMeasure), { completed: runEligibleRef.current });
```

(The pause path ~1758 and `onSilentStop` ~799 are untouched — they get the `false` default.)

RunSummary render in ScorePlayer (~2120), next to `mixedTempo`:

```jsx
          mixedTempo={!!summaryRun?.mixed}
          completed={!!summaryRun?.completed}
```

`RunSummary.jsx` — destructure `completed = false` alongside `mixedTempo = false`; JSDoc line: `* @param {boolean} [p.completed] - this run played the whole piece (§H eligibility) — only a completed run's tier cell is marked current`; and the predicate:

```js
              const current = !mixedTempo && completed && t === tier;
```

- [ ] **Step 4: Run both files fully — the completed-run highlight must survive**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RunSummary.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS — in particular the completed-run tests asserting exactly one `--current` (ScorePlayer.test.jsx ~1505, RunSummary ~53).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RunSummary.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RunSummary.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano): the current-tier highlight only marks completed runs — partial runs belong to no column"
```

---

### Task 6: `scoreLabel` reads the run's frozen tier, never the live knob

The live Polish readout computes `displayScore(base, tierOf(tempoMult))` — a mid-run tempo bump past 1.0 re-labels (and ×1.25s) a run that `runMixedRef` already voided. Read the run's captured tier (`runTierRef`), and show the unmultiplied base for a voided run. This also fixes stale-comment item (c): the header's "mid-run the two agree" claim is exactly this bug.

**Files:**
- Modify: `SheetMusic/ScorePlayer.jsx:1696-1706` (comment + memo)
- Test: `SheetMusic/ScorePlayer.test.jsx` (Polish tiers describe)

**Interfaces:**
- Consumes: `runTierRef` (frozen at Play), `runMixedRef` (set by `onTempo` while `runActiveRef`), `displayScore(base, null)` returns `base` (only `'overclocked'` multiplies — `polishTiers.js:39-42`), `position()` test helper (reads the bar's position testid, which is `` `${scoreLabel} · ${positionCore}` ``).
- Produces: no API change; `tierOf` may become unused in ScorePlayer — check imports.

- [ ] **Step 1: Write the failing test**

In the Polish tiers describe:

```js
  it('the live score readout keeps the RUN\'s tier across a mid-run tempo change — no overclock credit on a voided run', async () => {
    h.layoutExtras = tierFixture(3, 1);
    renderPlayer();
    pickMode('Polish');
    await act(async () => {});
    await pressPlay();                        // 100% — tier 'full', no multiplier
    act(() => vi.advanceTimersByTime(COUNT_IN_MS));
    play(60);
    act(() => vi.advanceTimersByTime(1000));  // m0 graded — a live base score exists
    const before = position().split(' · ')[0]; // e.g. "100%"
    pickTempo('125%');                        // voids the run; the live knob is now 'overclocked'
    expect(position().split(' · ')[0]).toBe(before); // the readout must NOT jump ×1.25
  });
```

- [ ] **Step 2: Run — verify it fails (the label jumps today)**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot -t "overclock credit"`
Expected: FAIL — the post-change label is `Math.round(base * 1.25)`%.

- [ ] **Step 3: Implement**

Replace the memo AND its header comment (~1696-1706) with:

```js
  // ── Polish tempo tiers: live readout + summary props (wave-3 H) ──────────────
  // The bar's score prefix. Derived from `grades`, so it moves on a per-MEASURE
  // cadence (not per step) — and it is consumed by the bar SHELL, which already
  // re-renders per step, so the memoized clusters keep bailing out. Reads the
  // RUN's tier (runTierRef, frozen at Play), never the live knob: a mid-run
  // change voids the run (runMixedRef), and its readout then shows the plain
  // base — re-labeling (or ×1.25-ing) a voided run would grade a tier it never
  // ran. tempoMult stays a dependency so the change that flips those refs also
  // recomputes this.
  const scoreLabel = useMemo(() => {
    if (mode !== 'polish') return null;
    const base = runScore(grades);
    if (base == null) return null;
    return `${displayScore(base, runMixedRef.current ? null : runTierRef.current)}%`;
  }, [mode, grades, tempoMult]);
```

Then check whether `tierOf` is still used elsewhere in ScorePlayer.jsx (grep within the file); if not, drop it from the `polishTiers.js` import.

- [ ] **Step 4: Run the tiers describe + overclock tests**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS — including the pre-existing overclock banking tests (~1808-1843): a run STARTED at 125% still shows/banks the multiplied score (its `runTierRef` IS `'overclocked'`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "fix(piano): the live Polish readout uses the run's frozen tier — no overclock credit on a voided run"
```

---

### Task 7: Stale comment fixes (comment-only)

Four comments contradict the code they sit on. No behavior change; the edits below are the whole task.

**Files:**
- Modify: `SheetMusic/ScoreTransportBar.jsx:300-303`, `SheetMusic/ScorePlayer.jsx:1606-1611`, `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.jsx:19-22`, `SheetMusic/countIn.js:67-70`, `SheetMusic/countIn.test.js:59-60`

- [ ] **Step 1: Apply the four edits**

1. **ScoreTransportBar.jsx** Listen bullet — currently claims Listen includes "the Learn-only Play lockout". `playLocked` is only ever passed as `learnGate` (ScorePlayer ~2072); Listen's Play is always live. Replace the bullet's tail:

```
 *  Listen  — all live, including a free-running metronome (session-local, same
 *            as Learn's — gated by `clickDisabled`, the caller's tempo-map
 *            guard, not the mode, wave-3 G); Key live. Play is never locked
 *            (`playLocked` is only ever passed for Learn's gate). No loop cluster.
```

2. **ScorePlayer.jsx ~1610** — "Same shape for a Listen part change, which rebuilds the note timeline." undersells the audience (Learn's machine states perform the same timeline, wave-3 §B; `onCyclePart`/`onHandsChange` route here whenever `sendsAudio`). Replace that sentence with: `// Same shape for an audio-plane part/hand change (Listen AND Learn's machine states perform the timeline — wave-3 §B), which rebuilds the note timeline.`

3. **transport/KeySheet.jsx ~19-21** — the cell label goes through `abbrevKey` ("D major" → "DM"); only the footer shows the full name. Replace the comment:

```js
  // Each cell speaks the SOUNDING key when the written key is known (label =
  // abbreviated key name, sub = offset), so the picker reads "DM / +2" instead
  // of a bare offset — the full name lives in the footer ("Sounding key: D
  // major"). Unknown key falls back to today's offset-only label.
```

(Note: the stale comment is ONLY in `transport/KeySheet.jsx`; `producer/KeySheet.jsx` is a different file — leave it alone.)

4. **countIn.js ~68-70 and countIn.test.js ~59-60** — both claim "the top of TEMPO_STEPS is 1.5x" with `216 × 1.5 = 324` math. The ladder tops at **1.75×** (`transport/TempoSheet.jsx:8-12`). In each file update the factor to 1.75x and the worked example to `216bpm reaches 378 effective bpm` (countIn.js's clicks-per-bar figure becomes `(~94/min)`), keeping each sentence's surrounding structure intact.

- [ ] **Step 2: Verify nothing but comments changed, and the touched suites still pass**

Run: `git diff --stat` (5 files, comment lines only) and
`node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/countIn.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx frontend/src/modules/Piano/PianoKiosk/transport/ --reporter=dot`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk
git commit -m "docs(piano): fix four stale comments (Play lockout, part-change audience, KeySheet label, tempo-ladder top)"
```

---

### Task 8: `RangeHandleLayer` — scale-aware band slack + mutant-killing gesture tests

`BAND_SLACK_PX = 40` (RangeHandleLayer.jsx:22) ignores the engrave zoom, while the sibling `measureAtPoint` call site passes `slack: 40 * scale` (ScorePlayer.jsx:1350). Thread `scale` in. The layer's tests also leave three mutants alive — `TAP_SLOP_PX` (no boundary test), the slack constant (no geometry where it decides), and the `* 2` out-of-band weight (only exercised at an exact tie) — kill all three while touching the file.

**Files:**
- Modify: `SheetMusic/RangeHandleLayer.jsx` (props ~54-56, JSDoc ~45-52, `measureUnder` ~76-89)
- Modify: `SheetMusic/ScorePlayer.jsx` (~2025-2035, the `<RangeHandleLayer>` render)
- Test: `SheetMusic/RangeHandleLayer.test.jsx`

**Interfaces:**
- Consumes: ScorePlayer's `scale` state (~205); the test file's `pointerEvent`/`pDown`/`pMove`/`pUp` helpers and `mount(props)` (which spreads overrides — pass `measures`/`stepBoxes`/`range`/`scale` per test).
- Produces: `RangeHandleLayer` gains prop `scale = 1`.

The cross-system geometry (worked out against `measureUnder`'s metric `d = |dx| + (inBand ? 0 : 2·|dy-to-center|)`): system 1 spans y 100–160 (center 130), system 2 spans y 400–460 (center 430). Probe point y=190 is 30px below system 1 — inside a 40px band, outside a 20px one; its system-2 penalty is `2×240 = 480`.

- [ ] **Step 1: Write the failing/mutant-killing tests**

Append to `RangeHandleLayer.test.jsx`:

```js
describe('RangeHandleLayer — tap/drag boundary and band-slack geometry', () => {
  it('a 7px wobble is still a TAP; a 9px move is a DRAG (TAP_SLOP_PX = 8 boundary)', () => {
    // Tap side
    let onArm = vi.fn(); let onCommit = vi.fn();
    let { container } = mount({ onArm, onCommit });
    let h = handleIn(container);
    pDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 107, clientY: 130 }); // 7px < slop
    pUp(h, { pointerId: 1, clientX: 107, clientY: 130 });
    expect(onArm).toHaveBeenCalledWith('in');
    expect(onCommit).not.toHaveBeenCalled();
    // Drag side
    onArm = vi.fn(); onCommit = vi.fn();
    ({ container } = mount({ onArm, onCommit }));
    h = handleIn(container);
    pDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
    pMove(h, { pointerId: 1, clientX: 109, clientY: 130 }); // 9px > slop
    pUp(h, { pointerId: 1, clientX: 109, clientY: 130 });
    expect(onCommit).toHaveBeenCalledWith('in', 0, 'drag');
    expect(onArm).not.toHaveBeenCalled();
  });

  // Two systems; the x-offsets are tuned so the 40px band slack DECIDES the
  // winner (not just the score): with slack, the sys-1 box wins on pure dx;
  // without (or with a halved, scale-aware band), the out-of-band penalty
  // flips it to the sys-2 box under the pointer.
  const slackFixture = {
    stepBoxes: [
      { x: 100, top: 100, bottom: 160 }, // step 0 → measure 0 (system 1)
      { x: 570, top: 400, bottom: 460 }, // step 1 → measure 1 (system 2)
    ],
    measures: [
      { index: 0, firstStep: 0, lastStep: 0 }, { index: 1, firstStep: 1, lastStep: 1 },
    ],
    range: { inMeasure: 0, outMeasure: 1 },
  };
  // At (570, 190): sys-1 box d = 470 + (in band? 0 : 2·60=120); sys-2 box d = 0 + 2·240 = 480.

  it('the band slack keeps a just-below-the-staves drag on ITS system (kills BAND_SLACK_PX and weight mutants)', () => {
    const onPreview = vi.fn();
    const { container } = mount({ ...slackFixture, onPreview, onCommit: vi.fn() });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 570, clientY: 430 });
    pMove(h, { pointerId: 1, clientX: 570, clientY: 190 }); // 30px below system 1: in-band only via slack
    pUp(h, { pointerId: 1, clientX: 570, clientY: 190 });
    // slack 40 → sys-1 wins (470 < 480). slack 0 → 590 > 480, sys-2 would win.
    // weight ×1 instead of ×2 → sys-2's penalty halves to 240 and it would win.
    expect(onPreview).toHaveBeenLastCalledWith('out', 0);
  });

  it('the slack scales with the engrave zoom — at scale 0.5 the same point is out of band', () => {
    const onPreview = vi.fn();
    const { container } = mount({ ...slackFixture, scale: 0.5, onPreview, onCommit: vi.fn() });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 570, clientY: 430 });
    pMove(h, { pointerId: 1, clientX: 570, clientY: 190 }); // 30px gap > 40·0.5 = 20 slack
    pUp(h, { pointerId: 1, clientX: 570, clientY: 190 });
    expect(onPreview).toHaveBeenLastCalledWith('out', 1);
  });

  it('an over-weighted penalty would strand the drag on the wrong system (pins the ×2 from above)', () => {
    // Same probe, sys-1 box pushed to dx=500: ×2 → 480 < 500 + 0, sys-2 wins; a ×3
    // mutant inflates sys-2's penalty to 720 and sys-1 would win.
    const fixture = {
      ...slackFixture,
      stepBoxes: [
        { x: 100, top: 100, bottom: 160 },
        { x: 600, top: 400, bottom: 460 },
      ],
    };
    const onPreview = vi.fn();
    const { container } = mount({ ...fixture, onPreview, onCommit: vi.fn() });
    const h = handleOut(container);
    pDown(h, { pointerId: 1, clientX: 600, clientY: 430 });
    pMove(h, { pointerId: 1, clientX: 600, clientY: 190 }); // sys-1: 500 (in band); sys-2: 480
    pUp(h, { pointerId: 1, clientX: 600, clientY: 190 });
    expect(onPreview).toHaveBeenLastCalledWith('out', 1);
  });
});
```

- [ ] **Step 2: Run — expect exactly ONE failure (the scale test; the rest pass pre-fix)**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.test.jsx --reporter=dot`
Expected: the `scale 0.5` test FAILS (component ignores the prop today → still in-band → measure 0); the other three PASS against current code (they pin current, correct behavior — verify they do; if one fails, the worked geometry is off and must be re-derived from `measureUnder` before proceeding).

- [ ] **Step 3: Implement the scale prop**

`RangeHandleLayer.jsx` — destructure:

```js
export default function RangeHandleLayer({
  measures = [], stepBoxes = [], range = null, onArm, onCommit, onPreview, scrollRef, scale = 1,
}) {
```

JSDoc (~45-52): add `* @param {number} [p.scale] - engrave zoom; the vertical band slack is in on-screen px, so it scales with the sheet the way measureAtPoint's call site already does (40 * scale)`.

`measureUnder` — scale the slack (and add `scale` to the `useCallback` deps):

```js
      const slack = BAND_SLACK_PX * scale; // on-screen px — tracks the engrave zoom (see measureAtPoint's call site)
      const inBand = pt.y >= b.top - slack && pt.y <= b.bottom + slack;
```

(hoist `const slack` above the `for` loop). `ScorePlayer.jsx` render (~2025-2035): add `scale={scale}` to the `<RangeHandleLayer>` props.

- [ ] **Step 4: Run the layer suite + ScorePlayer suite**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx --reporter=dot`
Expected: PASS, all.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx
git commit -m "fix(piano): range-handle band slack tracks the engrave zoom; kill the tap-slop and tie-break mutants"
```

---

### Task 9: Composer — evict stale pending onsets (dropped note_offs)

`pendingOnsetsRef` (`useComposerInput.js`) has NO cleanup path: a note_on whose note_off never arrives (BLE MIDI drop) stays queued forever. Worse than the memory: removal is FIFO (`queue.shift()`), so one dropped note_off permanently desynchronizes that pitch — every later note_off resolves the STALE head (huge heldMs → always `'quarter'`) and strands the fresh one. Lazy age-based eviction inside the already-firing MIDI callback fixes both, with no timer. Evicted notes keep their inserted type (do NOT late-reclassify: 30s later the user may have set that note's duration by numpad, and a delayed write would clobber it).

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.js` (constant near `CHORD_ONSET_TOLERANCE_MS` ~47; sweep inside the MIDI subscription callback, note_off branch ~253-259 and armed note_on push ~349-351)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.test.js`

**Interfaces:**
- Consumes: the test file's `armedHarness()` (returns `{ logger, midi, getState }`), `eventNames(logger)` helper, explicit `time:` values on MIDI events (no fake timers needed).
- Produces: `export const MAX_PENDING_ONSET_MS = 30000;` and a `composer.input.onset-evicted` log event.

- [ ] **Step 1: Write the failing test**

In the `duration classification` describe of `useComposerInput.test.js` (import `MAX_PENDING_ONSET_MS` alongside the existing `CHORD_ONSET_TOLERANCE_MS` import):

```js
    it('a dropped note_off no longer poisons later presses of the same pitch — stale onsets evict', () => {
      const { logger, getState, midi } = armedHarness();
      midi({ type: 'note_on', note: 60, velocity: 80, time: 1000 }); // its note_off is DROPPED (BLE)
      const later = 1000 + MAX_PENDING_ONSET_MS + 1000;
      midi({ type: 'note_on', note: 60, velocity: 80, time: later });     // the sweep evicts the stale head here
      midi({ type: 'note_off', note: 60, time: later + 80 });             // an 80ms hold on the SECOND press
      const notes = getState().score.parts[0].measures[0].notes;
      expect(notes).toHaveLength(2);
      expect(notes[0].type).toBe('quarter'); // the abandoned note keeps its inserted default — never late-reclassified
      expect(notes[1].type).toBe('16th');    // the note_off resolved the FRESH onset, not the stale head
      expect(eventNames(logger)).toContain('composer.input.onset-evicted');
    });
```

(Check the test file's `mockLogger()` first: if its `eventNames` helper doesn't surface `warn`-level events, assert the eviction directly — `expect(logger.warn).toHaveBeenCalledWith('composer.input.onset-evicted', expect.objectContaining({ note: 60 }))` — rather than changing the production log level to suit the helper.)

- [ ] **Step 2: Run — verify it fails on `notes[1].type`**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.test.js --reporter=dot -t "poisons"`
Expected: FAIL — today the note_off shifts the STALE head, so `notes[1].type` stays `'quarter'` (and no eviction event exists).

- [ ] **Step 3: Implement**

Below `CHORD_ONSET_TOLERANCE_MS` (~47) add:

```js
// Pending-onset eviction horizon. An armed onset whose note_off never arrives
// (BLE drop) must not live forever: the Map grows on a kiosk that never
// unmounts, and — worse — removal is FIFO per pitch, so one stale head makes
// every later note_off of that pitch resolve the WRONG onset (huge heldMs →
// always 'quarter') and strands the real one. Swept lazily on MIDI events; no
// human hold approaches 30s (long-class starts at MEDIUM_MAX_MS = 450ms).
// Evicted notes keep their inserted type — a late reclassify could clobber a
// duration the user has since set by numpad.
export const MAX_PENDING_ONSET_MS = 30000;
```

Inside the subscription `useEffect`'s callback (it closes over `log` and the refs), define once, above the `note_off` handling:

```js
      // Drop armed onsets past the eviction horizon (see MAX_PENDING_ONSET_MS).
      const evictStaleOnsets = (now) => {
        for (const [note, queue] of pendingOnsetsRef.current) {
          while (queue.length && now - queue[0].t > MAX_PENDING_ONSET_MS) {
            const stale = queue.shift();
            log.warn('composer.input.onset-evicted', { note, pitch: stale.pitch, ageMs: now - stale.t });
          }
          if (!queue.length) pendingOnsetsRef.current.delete(note);
        }
      };
```

Call it in BOTH branches, right after each computes `t`:
- note_off branch: `evictStaleOnsets(t);` immediately before `const queue = pendingOnsetsRef.current.get(evt.note);` — the head a stale entry would poison is gone before `shift()`.
- armed note_on path: `evictStaleOnsets(t);` immediately before the `const queue = pendingOnsetsRef.current.get(evt.note) ?? [];` push block — caps growth even if no note_off ever arrives again.

- [ ] **Step 4: Run the whole composer input suite**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer/ --reporter=dot`
Expected: PASS — especially the FIFO same-pitch double-press test (~396) and the stray-note_off no-op test (~408), which pin the behaviors the sweep must not disturb.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.js frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.test.js
git commit -m "fix(piano): evict stale composer onsets — a dropped note_off no longer leaks or poisons duration classes"
```

---

### Task 10: Shared stem rules — extract to MusicNotation, route SvgStaffRenderer through them

`SvgStaffRenderer` (ActionStaff family: PianoTetris, Flashcards, SideScroller, EngagementGate, producer LibraryBrowser preview) stems by average position with the OPPOSITE middle-line convention (`avgPos <= 4` → up, i.e. a middle-line note stems UP). `wetGlyphs` has the correct engraving rules (`stemDirectionFor`: farthest-from-middle decides, middle-line/ties stem DOWN; `stemLengthUnits`: far-ledger extension). Both use identical position units (staff half-steps above the bottom line, middle line = 4) and Y-down screen space, so the port is direct. But `wetGlyphs.jsx` lives in the Composer module — MusicNotation must not import from Piano. Extract the pure helpers into `MusicNotation/model/stems.js` and have both consume it.

**Files:**
- Create: `frontend/src/modules/MusicNotation/model/stems.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetGlyphs.jsx` (~45-104: constants + two functions move out; import + re-export)
- Modify: `frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.jsx:102-114`
- Test: `frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.test.jsx`

**Interfaces:**
- Consumes: `stemDirectionFor(positions: number|number[]) => 'up'|'down'` and `stemLengthUnits(position: number, direction?: 'up'|'down') => number` (lineSpacing units), moved VERBATIM from wetGlyphs.jsx:69-82 and 97-104, with `MIDDLE_LINE = 4`, `STEM_LEN_UNITS = 3.5`, `STEM_MIN_UNITS = 2.5`, `OCTAVE_HALF_STEPS = 7`.
- Produces: `MusicNotation/model/stems.js` exporting all of the above (`OCTAVE_HALF_STEPS` stays unexported, as today). `wetGlyphs.jsx` re-exports `MIDDLE_LINE`, `STEM_LEN_UNITS`, `STEM_MIN_UNITS`, `stemDirectionFor`, `stemLengthUnits` so `PendingLayer.jsx`, `LearnInkLayer.jsx` and `wetGlyphs.test.jsx` need no changes.

- [ ] **Step 1: Write the failing SvgStaffRenderer tests**

The renderer's stem x reveals direction: `stemX = stemUp ? baseX + 8 : baseX - 8` with `baseX = 65` → up = 73, down = 57. Positions: E4 (midi 64) = 0, G4 (67) = 2, A4 (69) = 3, B4 (71) = 4 (middle line), D5 (74) = 6 — all treble, all natural. Append to `SvgStaffRenderer.test.jsx`:

```jsx
  // Stem rules are shared with wet ink (MusicNotation/model/stems.js): the
  // notehead farthest from the middle line decides, and a middle-line note
  // stems DOWN — engraving convention, the opposite of the old avg<=4 rule.
  it('a middle-line note (B4) stems DOWN, matching wet ink', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[71]} />);
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('57'); // baseX - 8 = down
  });

  it('a low note (E4) stems UP', () => {
    const { container } = render(<SvgStaffRenderer targetPitches={[64]} />);
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('73'); // baseX + 8 = up
  });

  it('the farthest-from-middle notehead decides a chord, not the average', () => {
    // Positions 2/3/6: avg 3.67 (old rule → up); farthest is 6, two above the
    // middle line (correct rule → down).
    const { container } = render(<SvgStaffRenderer targetPitches={[67, 69, 74]} />);
    expect(container.querySelector('.action-staff__stem').getAttribute('x1')).toBe('57');
  });
```

- [ ] **Step 2: Run — verify the middle-line and chord tests fail, the low-note test passes**

Run: `node_modules/.bin/vitest run frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.test.jsx --reporter=dot`
Expected: 2 FAIL (B4 stems up today at x=73; the 2/3/6 chord averages to up), 1 PASS (E4 up under both rules — it anchors that the port doesn't flip everything).

- [ ] **Step 3: Create `MusicNotation/model/stems.js`**

Move the following VERBATIM out of `wetGlyphs.jsx` (keeping every comment line that travels with them): `export const MIDDLE_LINE = 4;`, `export const STEM_LEN_UNITS = 3.5;`, `export const STEM_MIN_UNITS = 2.5;`, `const OCTAVE_HALF_STEPS = 7;`, `export function stemDirectionFor(positions) {...}`, `export function stemLengthUnits(position, direction = 'up') {...}`. Give the file a short header:

```js
// Stem engraving rules shared by every staff surface (wet ink, ActionStaff).
// Positions are staff half-steps above the BOTTOM line (bottom line = 0, middle
// line = 4) — the convention of both model/pitch.js getStaffPosition and the
// Composer's staffPositionOf. Lengths are in lineSpacing units (spaces).
```

(`TOP_LINE` does NOT move — it's used by wetGlyphs' other layout code and is not a stem rule.)

- [ ] **Step 4: Rewire `wetGlyphs.jsx`**

Replace the moved declarations with an import + explicit re-export. IMPORTANT (repo gotcha): `export { x } from '...'` creates NO local binding — wetGlyphs' own code uses `MIDDLE_LINE` etc., so it must be a real import first:

```js
import { MIDDLE_LINE, STEM_LEN_UNITS, STEM_MIN_UNITS, stemDirectionFor, stemLengthUnits } from '../../../../MusicNotation/model/stems.js';
export { MIDDLE_LINE, STEM_LEN_UNITS, STEM_MIN_UNITS, stemDirectionFor, stemLengthUnits };
```

(Verify the relative path from `modes/Composer/` — the SheetMusic siblings import MusicNotation with four `../`.) Run the wet-ink consumers now to prove the re-export holds: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetGlyphs.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Composer/PendingLayer.test.jsx --reporter=dot` → PASS.

- [ ] **Step 5: Port `SvgStaffRenderer`**

Import: `import { stemDirectionFor, stemLengthUnits } from '../model/stems.js';`. Replace lines ~105-114 — currently:

```jsx
          const sorted = [...notePositions].sort((a, b) => a.position - b.position);
          const avgPos = sorted.reduce((s, n) => s + n.position, 0) / sorted.length;
          const stemUp = avgPos <= 4;

          const noteYs = sorted.map((np) => bottomLineY - np.position * stepSize);

          const stemLen = lineSpacing * 3.5;
```

with:

```jsx
          const sorted = [...notePositions].sort((a, b) => a.position - b.position);
          // Shared engraving rules (model/stems.js): the notehead farthest from
          // the middle line decides the group; the outer notehead (the one the
          // stem extends beyond) sets the length, far-ledger extension included.
          const dir = stemDirectionFor(sorted.map((n) => n.position));
          const stemUp = dir === 'up';
          const outerPos = stemUp ? sorted[sorted.length - 1].position : sorted[0].position;

          const noteYs = sorted.map((np) => bottomLineY - np.position * stepSize);

          const stemLen = lineSpacing * stemLengthUnits(outerPos, dir);
```

The `stemX`/`stemTop`/`stemBottom` lines below stay as they are (they key off `stemUp`, whose meaning is unchanged).

- [ ] **Step 6: Run every consumer surface's tests**

Run: `node_modules/.bin/vitest run frontend/src/modules/MusicNotation/ frontend/src/modules/Piano/PianoKiosk/modes/Composer/ frontend/src/modules/Piano/PianoKiosk/modes/Videos/EngagementGate.test.jsx --reporter=dot`
Expected: PASS (the new stem tests now green; EngagementGate/Notation smoke tests unaffected — they assert counts, not directions).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/MusicNotation/model/stems.js frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.jsx frontend/src/modules/MusicNotation/renderers/SvgStaffRenderer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetGlyphs.jsx
git commit -m "refactor(piano): shared stem rules in MusicNotation/model/stems.js — SvgStaffRenderer drops the avg-position/backwards-middle-line stemming"
```

---

### Task 11: Spelling modules — document the deliberate split (no merge)

**Decision (recorded here, overridable):** `model/spelling.js` (degree-relative, key-NAME-keyed, octaveless — chord/theory surfaces) and `model/spellMidi.js` (fifths-keyed, `{step,alter,octave}`, sharps-for-chromatics — wet ink) STAY SEPARATE. A merge would either change wet-ink chromatic spelling (spellMidi is sharps-always off-key BY DESIGN — a struck wrong note has no chord/degree context) or force a fifths↔name bridge with no consumer benefit. The residual's real cost is a future reader "consolidating" them wrongly — fix that with cross-reference headers, and flag the one genuine triplication (the C♭/B♯ octave-wrap rule, re-implemented locally in `chordStaff.js`'s `midiToVexKey`).

**Files:**
- Modify: `frontend/src/modules/MusicNotation/model/spelling.js` (header), `frontend/src/modules/MusicNotation/model/spellMidi.js` (header), `frontend/src/modules/MusicNotation/renderers/chordStaff.js` (`midiToVexKey` ~143-153, one comment line)

- [ ] **Step 1: Add the cross-references**

`spelling.js` — append to the existing header block:

```js
// NOT the same speller as model/spellMidi.js, on purpose. spellMidi answers
// "how does the SOUNDING key spell this struck MIDI note" — fifths-keyed,
// returns {step, alter, octave}, and spells every non-diatonic note with
// SHARPS (wet ink has no chord/degree context to lean on). This module answers
// "how does this key/chord spell this pitch class" — degree-relative leans,
// chord-quality tie-breaks, octaveless. Merging them would change wet-ink
// chromatic spelling or force a fifths↔name bridge nobody consumes.
```

`spellMidi.js` — append to its header:

```js
// NOT the same speller as model/spelling.js, on purpose: that one is
// degree-relative and chord-aware (plaque and chord staff must agree) but
// octaveless and key-NAME-keyed. This one is deliberately dumber — diatonic
// letters from the fifths, sharps for everything else — because a struck
// wrong note has no harmonic context. See spelling.js's header for the
// merge-would-change-behavior details.
```

`chordStaff.js` `midiToVexKey` — on (or adjacent to) the existing C♭ octave-correction line (`if (letter === 'C' && alter === -1) octave += 1;` area), add: `// Same letter-wrap rule as spellMidi.js's octave math — kept local because spellPitchClass is pitch-class-only (no octave to correct at the source).`

- [ ] **Step 2: Verify comment-only + suites green**

Run: `git diff --stat` (3 files, comments only) and `node_modules/.bin/vitest run frontend/src/modules/MusicNotation/model/ frontend/src/modules/Piano/theory/chordNaming.test.js --reporter=dot`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/MusicNotation/model/spelling.js frontend/src/modules/MusicNotation/model/spellMidi.js frontend/src/modules/MusicNotation/renderers/chordStaff.js
git commit -m "docs(piano): record the deliberate spelling.js / spellMidi.js split — divergent by policy, not by accident"
```

---

### Task 12: Close out the followups doc + full sweep

**Files:**
- Modify: `docs/_wip/plans/2026-07-29-sheetmusic-wave3-followups.md` ("Code follow-ups" section)

- [ ] **Step 1: Rewrite the "Code follow-ups" section**

Replace the bullet list with a resolution table: every item from Tasks 1–11 marked resolved with a one-line outcome + commit reference. Three items remain open, stated as such:
- Composer duration-classes numpad UX — **awaiting product sign-off** (decision, not code).
- Chord grouping — **awaiting `composer.input.chord-decision` field data** (add: stale-onset eviction from Task 9 now protects the data's integrity).
- Correct the record: the "mocks omitting `persistent` read as guest (`persistent !== false`)" claim was **wrong** — the production check is `isPersistentUser(id)` on an id string; no `persistent !== false` pattern exists in the codebase. The real gap (no `currentUser = null` test) was closed in Task 1.

Keep the on-device section untouched.

- [ ] **Step 2: Full sweep of every touched area**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/ frontend/src/modules/MusicNotation/ --reporter=dot`
Expected: PASS, zero failures. Capture the real summary line (Test Files / Tests counts) — do not infer success from a pipe's exit code.

- [ ] **Step 3: Commit**

```bash
git add docs/_wip/plans/2026-07-29-sheetmusic-wave3-followups.md
git commit -m "docs(piano): wave-3 code residuals resolved — followups doc now tracks only on-device + deferred items"
```

Integration (merge to main, build, deploy, kiosk reload) is a separate decision after review — use superpowers:finishing-a-development-branch. Deploy gates per CLAUDE.local.md apply (no active fitness session, no playing video); the piano tablet needs its FKB reload after any deploy.
