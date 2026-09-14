# Charades Recovery, Music, and Selector Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FHE Charades forgiving of accidental remote input, preserve and resume an active game, loop one configured music track without gaps for each guessing turn, lower that music relative to its current setting, and make the embedded Family Selector fill the available TV stage.

**Architecture:** Keep the activity-party ruleset authoritative for reversible phase changes and keep PartyGamesApp responsible for shell exit and session attachment. Keep GuessingMusic as the environment audio capability, but identify a selection by session and turn so a refresh resumes the same track. Preserve FamilySelector as the single wheel implementation and give its embedded variant a parent-sized layout contract instead of a fixed height.

**Tech Stack:** React 18, SCSS, shared JavaScript gaming rules, browser `Audio`, session storage, Vitest, Testing Library, Playwright, YAML configuration.

**Spec:** `docs/_wip/plans/2026-09-13-fhe-charades-design.md`, amended by the real-gameplay findings captured in this plan.

## Global Constraints

- Shield remote D-pad, OK/Enter, and Back/Escape must operate the complete flow without touch input.
- Back during guessing returns the same turn to its decoder-ready phase; it must not advance the performer, clue, round, or schedule.
- Leaving an active game requires an explicit confirmation, and a confirmed leave preserves a route-independent attachment that reopens the same authoritative session from the FHE preset.
- Completing the game or choosing Play Again clears the saved active-session attachment.
- One shuffled track is selected per guessing turn and loops for that entire turn; natural media end must never switch to a different track or leave a silent gap.
- Shuffle memory remains session-scoped and consumes the queue without repetition before a new cycle.
- Music source, repeat behavior, shuffle behavior, memory behavior, and volume remain authored configuration; no Plex identifier or FHE volume belongs in frontend source.
- The current FHE preset has `guessing_music.volume: 0.3`. Because `GuessingMusic` applies that value directly, “down to sixty percent” means `0.3 * 0.6 = 0.18`; setting it to `0.6` would double the current level.
- The embedded wheel must reuse FamilySelector's existing geometry, winner selection, upright-avatar counter-rotation, timing, and result overlay.
- At the living-room 960×540 CSS viewport, the wheel must use the available Charades body while remaining fully contained below the 62px show header.
- Use the structured logging framework and never log clue text or secret image contents.
- Preserve standalone FamilySelector behavior and competitive Party Games behavior.

---

### Task 1: Give embedded FamilySelector a parent-sized layout contract

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss`
- Modify: `frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.test.jsx`
- Modify: `frontend/src/modules/Gaming/experiences/charades/Charades.scss`
- Modify: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs`

**Interfaces:**
- Consumes: `FamilySelector`'s existing `embedded` prop and the `.charades__center` grid row between `ShowHeader` and the bottom of the stage.
- Produces: `.family-selector--embedded` fills the containing Charades section with `width: 100%`, `height: 100%`, and `min-height: 0`; `.wheel-rotator` remains square and resolves to the smaller usable dimension; standalone `.family-selector` retains its existing full-screen presentation.

- [ ] **Step 1: Add an embedded-markup regression to the component test**

Add this assertion to the existing embedded test so the styling hook cannot disappear during a future FamilySelector refactor:

```jsx
const embeddedSelector = document.querySelector('.family-selector--embedded');
expect(embeddedSelector).not.toBeNull();
expect(embeddedSelector.querySelector('.wheel-rotator')).not.toBeNull();
expect(embeddedSelector.querySelectorAll('.avatar-wrapper')).toHaveLength(1);
```

- [ ] **Step 2: Add failing browser geometry assertions at the first performer-selection phase**

In `fhe-charades.runtime.test.mjs`, immediately after the Charades stage becomes visible and before the wheel completes, measure the stage, header, selector, pointer, and wheel:

```js
const selectorLayout = await page.evaluate(() => {
  const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
  const stage = rect('.charades');
  const header = rect('.charades .gp-show-header');
  const selector = rect('.family-selector--embedded');
  const wheel = rect('.family-selector--embedded .wheel-rotator');
  const pointer = rect('.family-selector--embedded .wheel-pointer');
  return { stage, header, selector, wheel, pointer };
});
expect(selectorLayout.wheel.width).toBeGreaterThanOrEqual(380);
expect(Math.abs(selectorLayout.wheel.width - selectorLayout.wheel.height)).toBeLessThanOrEqual(1);
expect(selectorLayout.selector.top).toBeGreaterThanOrEqual(selectorLayout.header.bottom);
expect(selectorLayout.pointer.top).toBeGreaterThanOrEqual(selectorLayout.selector.top);
expect(selectorLayout.wheel.bottom).toBeLessThanOrEqual(selectorLayout.stage.bottom);
```

Run:

```bash
BASE_URL="${DAYLIGHT_BASE_URL:?export the target HTTPS origin}" npx playwright test tests/live/flow/gaming/fhe-charades.runtime.test.mjs --reporter=line --workers=1
```

Expected: FAIL because `.family-selector--embedded` is capped at `height: 290px`, producing a wheel below the 380px acceptance floor and leaving unused body space.

- [ ] **Step 3: Replace the embedded fixed height with containment-aware sizing**

Change only the embedded modifier in `FamilySelector.scss` to this contract:

```scss
.family-selector--embedded {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;

  .family-selector-container {
    min-height: 0;
    padding: clamp(2.25rem, 7vh, 3.5rem) 0 0;
  }

  .wheel-pointer {
    top: 0;
    font-size: clamp(2rem, 6vh, 3rem);
  }
}
```

Do not change `.wheel-rotator`, `RouletteWheel`, `WheelSegment`, or the avatar animation. Their existing `height: 100%`, `max-width: 100%`, and equal counter-rotation already preserve the square wheel and upright heads once the parent supplies the correct height.

- [ ] **Step 4: Make the Charades performer-selection section stretch its child**

Add a phase-specific class to the performer-ready section:

```jsx
<section className="charades__center charades__selector-stage">
```

Then add:

```scss
.charades__selector-stage {
  place-items: stretch;
  align-content: stretch;
  padding-block: 0;
}
```

This removes the center-grid intrinsic-size constraint for this phase only. Decoder, acting, and reveal layouts keep their current centered behavior.

- [ ] **Step 5: Run the focused component tests**

Run:

```bash
cd frontend && npx vitest run src/modules/AppContainer/Apps/FamilySelector/FamilySelector.test.jsx src/modules/Gaming/experiences/charades/Charades.test.jsx
```

Expected: PASS, including the existing authoritative-winner, one-person embedded, delayed-result, and upright-avatar behavior.

- [ ] **Step 6: Run the live geometry check and inspect the performer screenshot**

Run the Playwright command from Step 2. Expected: PASS at 960×540 with a square wheel at least 380px wide, no header overlap, no stage overflow, and the winner overlay centered over the enlarged wheel.

- [ ] **Step 7: Commit the responsive selector change**

```bash
git add frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.scss frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.test.jsx frontend/src/modules/Gaming/experiences/charades/Charades.jsx frontend/src/modules/Gaming/experiences/charades/Charades.scss tests/live/flow/gaming/fhe-charades.runtime.test.mjs
git commit -m "fix(gaming): fill charades stage with family selector"
```

---

### Task 2: Make one music selection durable for the whole guessing turn

**Files:**
- Modify: `frontend/src/modules/Gaming/environments/party-games/effects/GuessingMusic.js`
- Modify: `frontend/src/modules/Gaming/environments/party-games/effects/GuessingMusic.test.js`
- Modify: `frontend/src/modules/Gaming/experiences/charades/Charades.jsx`
- Modify: `frontend/src/modules/Gaming/experiences/charades/Charades.test.jsx`

**Interfaces:**
- Consumes: `guessing_music` with `{ source, volume, order: 'shuffle', repeat: 'one', memory: 'session' }`, authoritative `sessionId`, and `state.challenge_index`.
- Produces: `music.start(config, { sessionId, turnKey, onError })`; `turnKey` is the stable string form of `challenge_index`. The persisted shuffle bag records `selectedByTurn[turnKey] = mediaUrl`, so remounting the same turn reuses its track while a new turn consumes the next bag entry.

- [ ] **Step 1: Write a failing refresh/resume music test**

Add a test beside the existing single-track loop test:

```js
it('resumes the same selected track for the same session turn', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const first = new AudioDouble();
  new GuessingMusic({ audioFactory: () => first, resolveQueue: async () => threeTracks, random: () => 0, storage })
    .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
  await flush();
  const selected = first.src;

  const resumed = new AudioDouble();
  new GuessingMusic({ audioFactory: () => resumed, resolveQueue: async () => threeTracks, random: () => 0, storage })
    .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '4' });
  await flush();
  expect(resumed.src).toBe(selected);

  const nextTurn = new AudioDouble();
  new GuessingMusic({ audioFactory: () => nextTurn, resolveQueue: async () => threeTracks, random: () => 0, storage })
    .start({ source: 'test:music', order: 'shuffle', repeat: 'one', memory: 'session' }, { sessionId: 'fhe', turnKey: '5' });
  await flush();
  expect(nextTurn.src).not.toBe(selected);
});
```

- [ ] **Step 2: Run the music test and verify the current failure**

Run:

```bash
cd frontend && npx vitest run src/modules/Gaming/environments/party-games/effects/GuessingMusic.test.js
```

Expected: FAIL because the current persisted bag remembers what was consumed, but does not remember which track belongs to a particular turn; a new service instance consumes another track after refresh.

- [ ] **Step 3: Persist the per-turn selection inside the existing shuffle bag**

Extend `loadBag` so the normalized bag includes only valid current queue URLs:

```js
const selectedByTurn = Object.fromEntries(
  Object.entries(bag?.selectedByTurn || {}).filter(([, url]) => available.has(url)),
);
bag = { remaining, played, last: available.has(bag?.last) ? bag.last : null, selectedByTurn };
```

In `start`, read `turnKey` from the options. In `playNext`, before consuming `bag.remaining`, reuse `bag.selectedByTurn[String(turnKey)]` when it exists. When selecting a new URL, assign it to that key before `saveBag`. Keep `audio.loop = config.repeat === 'one'` and keep the existing `ended` fallback resetting `currentTime` and replaying the same `src`.

On an `error` event, delete the failed URL from the current turn's selection before choosing a replacement. This permits recovery from a corrupt track without treating natural completion as permission to change songs.

- [ ] **Step 4: Pass the authoritative turn identity from Charades**

Change the music start call to include:

```js
return gamingServices?.music?.start(definition.guessing_music, {
  sessionId,
  turnKey: String(state.challenge_index),
  onError: cause => setMusicError(cause?.message || 'Music could not start'),
});
```

Add `state.challenge_index` to the effect's existing dependency list if it is not already present. Do not derive the key from performer name, clue text, or component mount count.

- [ ] **Step 5: Update the Charades presenter test contract**

Change the existing expectation to assert both stable identifiers:

```js
expect(music.start).toHaveBeenCalledWith(
  expect.objectContaining({ repeat: 'one', memory: 'session' }),
  expect.objectContaining({ sessionId: 'one', turnKey: '0' }),
);
```

- [ ] **Step 6: Run focused audio and presenter tests**

Run:

```bash
cd frontend && npx vitest run src/modules/Gaming/environments/party-games/effects/GuessingMusic.test.js src/modules/Gaming/experiences/charades/Charades.test.jsx
```

Expected: PASS. The same `src` survives a same-turn service recreation; `ended` retains that `src`; turn `5` selects a different unplayed URL; stop still pauses, clears `src`, aborts resolution, and unsubscribes from master volume.

- [ ] **Step 7: Commit the durable per-turn music selection**

```bash
git add frontend/src/modules/Gaming/environments/party-games/effects/GuessingMusic.js frontend/src/modules/Gaming/environments/party-games/effects/GuessingMusic.test.js frontend/src/modules/Gaming/experiences/charades/Charades.jsx frontend/src/modules/Gaming/experiences/charades/Charades.test.jsx
git commit -m "fix(gaming): resume the same charades turn music"
```

---

### Task 3: Lock down reversible Back behavior and resumable confirmed exit

**Files:**
- Modify: `shared/gaming/rulesets/activity-party/activityParty.test.mjs`
- Modify: `frontend/src/modules/Gaming/environments/party-games/app/PartyGamesApp.test.jsx`
- Modify: `frontend/src/modules/Gaming/experiences/charades/Charades.test.jsx`
- Modify: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs`

**Interfaces:**
- Consumes: `challenge.rewind`, `registerBackAction(handler)`, `party-games:<definitionId>:active-session`, and the FHE preset identity `charades:fhe`.
- Produces: a tested navigation contract: Back in `performing` dispatches `challenge.rewind`; Back elsewhere in an active game opens `Leave game?`; confirming exits to FHE without clearing the saved session; reopening the same preset attaches that session; results and Play Again clear the saved attachment.

- [ ] **Step 1: Strengthen the ruleset rewind test with invariants**

Starting from a casual `performing` state with a non-null deadline, assert:

```js
expect(rewound.state).toMatchObject({
  phase: 'challenge-ready',
  deadline: null,
  challenge_index: state.challenge_index,
  clue_index: state.clue_index,
  performer_id: state.performer_id,
  challenge: state.challenge,
  remaining_ms: state.remaining_ms,
});
expect(rewound.events).toEqual([{ type: 'challenge.rewound' }]);
```

Also assert that a repeated `challenge.rewind` in `challenge-ready` returns `illegal_command` and that a non-host actor receives `authorization_denied`.

- [ ] **Step 2: Add shell tests for every saved-session lifecycle edge**

Extend `PartyGamesApp.test.jsx` with these cases:

```jsx
it('keeps the active attachment after confirmed leave and resumes it when reopened', async () => {
  // Start session-one, Escape, choose Leave game, unmount, then render the same
  // definition again. Assert fetchBoot receives sessionId: 'session-one' and
  // createSession remains at one call.
});

it('clears the attachment only on results or Play Again', async () => {
  // Seed the active key, attach a completed session, and assert results remove
  // it; start another session, trigger Play Again, and assert it is absent.
});
```

Use the existing `fetchBoot` and `createSession` mocks, the exact key `party-games:charades:family:active-session`, and role-based button queries. Do not assert implementation-private hook state.

- [ ] **Step 3: Prove Charades Back is scoped to guessing**

Expand the existing presenter test to assert the registered handler is removed when the fetched state becomes `challenge-ready`. Assert a Back handler call while `performing` sends exactly one `{ type: 'challenge.rewind' }`, and an in-flight rewind returns `false` on a second call so it cannot cross another phase.

- [ ] **Step 4: Run the rules and frontend recovery tests**

Run:

```bash
npx vitest run shared/gaming/rulesets/activity-party/activityParty.test.mjs
cd frontend && npx vitest run src/modules/Gaming/environments/party-games/app/PartyGamesApp.test.jsx src/modules/Gaming/experiences/charades/Charades.test.jsx
```

Expected: PASS. If any assertion fails, correct the smallest owning boundary: rules in `index.mjs`, phase registration in `Charades.jsx`, and shell confirmation/attachment in `PartyGamesApp.jsx`. Do not put rules state into local React storage.

- [ ] **Step 5: Extend the real remote flow through leave and reopen**

During turn 0 in `fhe-charades.runtime.test.mjs`:

1. Press OK to enter `performing`.
2. Press Back and assert the same session returns to `challenge-ready` with the same `challenge_index`, `performer_id`, and challenge ID.
3. Press Back again, assert the `Leave game?` dialog appears, and press OK on `Keep playing`; assert the dialog closes and the session remains mounted.
4. Open the dialog again, move focus to `Leave game`, and press OK; assert the FHE menu returns.
5. Reopen Charades and assert the URL and API attach the original `sessionId`, no second session POST occurs, and the same `challenge-ready` turn is restored.

- [ ] **Step 6: Run the full live flow**

Run:

```bash
BASE_URL="${DAYLIGHT_BASE_URL:?export the target HTTPS origin}" npx playwright test tests/live/flow/gaming/fhe-charades.runtime.test.mjs --reporter=line --workers=1
```

Expected: PASS with one session creation, successful rewind, cancelled exit, confirmed exit, same-session reopen, and completion of all 18 turns.

- [ ] **Step 7: Commit the recovery regression coverage and any owning-boundary correction**

```bash
git add shared/gaming/rulesets/activity-party/index.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs frontend/src/modules/Gaming/environments/party-games/app/PartyGamesApp.jsx frontend/src/modules/Gaming/environments/party-games/app/PartyGamesApp.test.jsx frontend/src/modules/Gaming/experiences/charades/Charades.jsx frontend/src/modules/Gaming/experiences/charades/Charades.test.jsx tests/live/flow/gaming/fhe-charades.runtime.test.mjs
git commit -m "test(gaming): lock charades recovery behavior"
```

Before staging, omit unchanged files from the `git add` command so this commit contains only the tested recovery changes.

---

### Task 4: Apply the FHE audio preset, update the contract documentation, and certify production

**Files:**
- Modify external configuration: `{DAYLIGHT_DATA_PATH}/household/gaming/games/charades:fhe/rules.yml`
- Modify: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs`
- Modify: `docs/reference/gaming/party-games.md`
- Modify: `docs/_wip/plans/2026-09-13-charades-recovery-music-selector-remediation.md`

**Interfaces:**
- Consumes: the `charades:fhe` rules artifact and the queue referenced by its existing `guessing_music.source`.
- Produces: `guessing_music: { source: <existing authored value>, volume: 0.18, order: shuffle, repeat: one, memory: session }`; live projection matches all five fields; documentation describes same-track repeat and same-turn resume.

- [x] **Step 1: Back up and edit the mounted FHE rules artifact**

Copy the current external file into the gitignored evidence directory before editing:

```bash
mkdir -p .superpowers/evidence/charades-remediation-2026-09-13/config-backups
TASK_DATA_PATH="$(jq -r '.env.DAYLIGHT_DATA_PATH' .claude/settings.local.json)"
cp "${TASK_DATA_PATH}/household/gaming/games/charades:fhe/rules.yml" .superpowers/evidence/charades-remediation-2026-09-13/config-backups/charades-fhe-rules.yml
```

Keep the existing source and change only `volume`, `order`, `repeat`, and `memory`. Apply the edit without embedding the instance-owned source in tracked files:

```bash
TASK_DATA_PATH="$(jq -r '.env.DAYLIGHT_DATA_PATH' .claude/settings.local.json)"
TASK_RULES_PATH="${TASK_DATA_PATH}/household/gaming/games/charades:fhe/rules.yml"
TASK_RULES_PATH="${TASK_RULES_PATH}" node --input-type=module <<'NODE'
import fs from 'node:fs';
import yaml from 'js-yaml';

const path = process.env.TASK_RULES_PATH;
const rules = yaml.load(fs.readFileSync(path, 'utf8'));
rules.guessing_music = {
  ...rules.guessing_music,
  volume: 0.18,
  order: 'shuffle',
  repeat: 'one',
  memory: 'session',
};
fs.writeFileSync(path, yaml.dump(rules, { lineWidth: -1, noRefs: true }));
NODE
```

The source appears here because this is the instance-owned YAML value already present in the artifact. Do not copy it into JavaScript, generic defaults, or reference documentation.

- [x] **Step 2: Update the live projection and effective-volume assertions**

Replace the instance-specific source equality with a scheme assertion and check the reusable settings explicitly:

```js
expect(definition.guessing_music.source).toMatch(/^plex:/);
expect(definition.guessing_music).toMatchObject({
  volume: 0.18,
  order: 'shuffle',
  repeat: 'one',
  memory: 'session',
});
```

For each observed guessing Audio element, assert `audio.volume` is `0.18 * effectiveMaster`. The living-room master is fixed at `1`, so the live expectation is `0.18`. Keep the separate sound-cue assertion at `0.4`; the requested reduction applies only to guessing music.

- [x] **Step 3: Correct the Party Games reference contract**

Replace the current paragraph that says `repeat: after-cycle` advances to a new track on media end. Document these two supported policies precisely:

```text
`repeat: after-cycle` advances through the shuffled bag when a track ends.
`repeat: one` assigns one shuffled track to the authoritative turn and loops
that track until guessing ends. With `memory: session`, both the remaining bag
and the turn assignment survive a page refresh, so resuming a turn does not
change its music. Volume is a 0..1 definition value multiplied by the screen
master volume.
```

- [x] **Step 4: Validate the authored catalog and focused tests**

Run:

```bash
npm run gaming:party -- catalog
npx vitest run shared/gaming/rulesets/activity-party/activityParty.test.mjs
cd frontend && npx vitest run src/modules/AppContainer/Apps/FamilySelector/FamilySelector.test.jsx src/modules/Gaming/environments/party-games/app/PartyGamesApp.test.jsx src/modules/Gaming/environments/party-games/effects/GuessingMusic.test.js src/modules/Gaming/experiences/charades/Charades.test.jsx
```

Expected: the catalog reports `charades:fhe` valid, rules tests pass, and all focused frontend tests pass.

- [ ] **Step 5: Build the frontend and run the full production-target flow**

Run:

```bash
npm run check:parse
npm run check:scss
npm run build --prefix frontend
BASE_URL="${DAYLIGHT_BASE_URL:?export the target HTTPS origin}" npx playwright test tests/live/flow/gaming/fhe-charades.runtime.test.mjs --reporter=line --workers=1
```

Expected: all commands exit 0. The live flow proves wheel geometry, remote rewind, confirmation cancel, confirmed leave and same-session reopen, stable per-turn looped track, effective volume `0.18`, no music after reveal, and all 18 turns completing once.

- [x] **Step 6: Commit tracked documentation and runtime assertions**

```bash
git add tests/live/flow/gaming/fhe-charades.runtime.test.mjs docs/reference/gaming/party-games.md docs/_wip/plans/2026-09-13-charades-recovery-music-selector-remediation.md
git commit -m "docs(gaming): certify charades recovery and audio contract"
```

- [ ] **Step 7: Deploy with the repository gate and verify build identity**

Run the gate as an independent halting step:

```bash
./scripts/deploy-gate.sh
```

After a clear gate, build:

```bash
./scripts/build-daylight.sh
```

Run `./scripts/deploy-gate.sh` again. After the second clear result:

```bash
sudo docker stop daylight-station
sudo docker rm daylight-station
sudo deploy-daylight
curl -fsS "${DAYLIGHT_BASE_URL:?export the target HTTPS origin}/build.txt"
```

Expected: `/build.txt` reports the deployed full commit SHA. If the gate reports active use, stop before the container lifecycle commands; the six-hour override from the earlier session is expired and is not part of this plan.

- [ ] **Step 8: Record final evidence and close the plan**

Attach the Playwright output, first-wheel geometry JSON, same-session ID before and after reopening, selected track URL before and after synthetic `ended`, resumed same-turn track URL, and observed guessing volume under `.superpowers/evidence/charades-remediation-2026-09-13/`. Mark each checkbox complete only after its command and expected observation both succeed.
