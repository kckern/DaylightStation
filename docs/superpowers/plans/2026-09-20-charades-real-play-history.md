# Charades Real-Play History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist real Charades clue plays and exclude them from later games until each eligible presentation pool is exhausted.

**Architecture:** A YAML adapter owns an ordered, idempotent per-definition play ledger. `GamingApplication` captures that history into session setup before creation and records committed `challenge.finished` turns; the pure Activity Party selector consumes the captured list, preserving deterministic journal replay.

**Tech Stack:** Node.js ES modules, YAML, Vitest, the shared Gaming kernel, Playwright live-flow tests.

**Spec:** `docs/superpowers/specs/2026-09-20-charades-real-play-history-and-static-decoder-design.md`

## Global Constraints

- Only session `game:4978457a-e9f0-4bee-b941-765d5daa33a6` seeds prior real play.
- Raw snapshots and journals remain audit/replay records and never implicitly count as clue history.
- Image and text pools exhaust independently because presentation is participant-configured.
- Session setup captures history so later ledger changes cannot make journal replay diverge.
- A committed challenge is recorded exactly once; rewind and reveal do not count as another play.
- Existing authored and competitive Activity Party selection remains unchanged.

## Review Focus

- A history containing deleted or filtered clue IDs ignores them without blocking current content (Task 1 test).
- A session that crosses a pool boundary uses every remaining unused clue before recycling (Task 1 test).
- A retried committed command repairs or deduplicates the same ledger entry (Task 3 test).
- A journal replay after history changes reproduces its original order from captured setup (Task 2 test).
- Two different definition IDs never share exclusion history (Task 3 adapter test).

---

### Task 1: Cycle-aware deterministic clue selection

**Files:**
- Modify: `shared/gaming/rulesets/activity-party/charadesSelection.mjs:13-53`
- Modify: `shared/gaming/rulesets/activity-party/charadesSelection.test.mjs:1-75`

**Interfaces:**
- Consumes: `historyIds: string[]`, an oldest-to-newest list captured for one definition.
- Produces: `createCharadesChallengeOrder({ challenges, turnOrder, cluesPerTurn, imageParticipantIds, historyIds, seed }) -> { order, presentations, rngState }`.

- [ ] **Step 1: Add failing selection tests**

```js
it('uses every currently-unused clue before recycling an exhausted pool', () => {
  const result = createCharadesChallengeOrder({
    challenges: challenges.slice(0, 3),
    turnOrder: ['a', 'a', 'a'], cluesPerTurn: 1, imageParticipantIds: ['a'],
    historyIds: ['image-0', 'image-1'], seed: 7,
  });
  expect(challenges[result.order[0]].id).toBe('image-2');
  expect(new Set(result.order.slice(1)).size).toBe(2);
});

it('derives the current cycle after complete historical exhaustion', () => {
  const result = createCharadesChallengeOrder({
    challenges: challenges.slice(0, 3), turnOrder: ['a'], cluesPerTurn: 1,
    imageParticipantIds: ['a'], historyIds: ['image-0', 'image-1', 'image-2', 'image-1'], seed: 4,
  });
  expect(challenges[result.order[0]].id).not.toBe('image-1');
});

it('ignores historical ids absent from the current eligible bank', () => {
  const result = createCharadesChallengeOrder({
    challenges: challenges.slice(0, 2), turnOrder: ['a'], cluesPerTurn: 1,
    imageParticipantIds: ['a'], historyIds: ['retired-clue'], seed: 2,
  });
  expect(result.order).toHaveLength(1);
});
```

- [ ] **Step 2: Run the selector tests and confirm the new expectations fail**

Run: `npx vitest run shared/gaming/rulesets/activity-party/charadesSelection.test.mjs`

Expected: FAIL because `historyIds` does not influence selection.

- [ ] **Step 3: Implement pool-cycle derivation and unused-first draws**

```js
function usedInCurrentCycle(pool, challenges, historyIds) {
  const eligible = new Set(pool.map(index => String(challenges[index].id)));
  const used = new Set();
  for (const id of historyIds || []) {
    const key = String(id);
    if (!eligible.has(key)) continue;
    used.add(key);
    if (used.size === eligible.size) used.clear();
  }
  return used;
}
```

Initialize each pool cursor with unused indices followed by a fresh full-pool
cycle. Preserve `nextFromPool`'s no-immediate-repeat swap and seeded RNG state;
do not filter `definition.challenges` or change stored indices.

- [ ] **Step 4: Run selector and complete Activity Party unit suites**

Run: `npx vitest run shared/gaming/rulesets/activity-party/charadesSelection.test.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the pure selection behavior**

```bash
git add shared/gaming/rulesets/activity-party/charadesSelection.mjs shared/gaming/rulesets/activity-party/charadesSelection.test.mjs
git commit -m "feat(gaming): avoid played charades clues until exhaustion"
```

### Task 2: Capture clue history in deterministic session setup

**Files:**
- Modify: `shared/gaming/rulesets/activity-party/index.mjs:84-104`
- Modify: `shared/gaming/rulesets/activity-party/activityParty.test.mjs:1-130`
- Modify: `backend/src/3_applications/gaming/runtime/GamingApplication.mjs:20-101`
- Modify: `backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs:1-180`

**Interfaces:**
- Consumes: `clueHistory.list(definitionId) -> Promise<Array<{ clue_id: string }>>`.
- Produces: journaled `setup.charades_history_ids: string[]`; passes it to `createCharadesChallengeOrder` as `historyIds`.

- [ ] **Step 1: Add a failing ruleset test for captured history**

```js
it('uses only history captured in setup and replays the same order', () => {
  const setup = { charades_history_ids: ['image-0', 'text-0'] };
  const first = activityPartyRuleModule.createInitialState(definition, {
    seed: 42, seats: performers, setup,
  });
  const replay = activityPartyRuleModule.createInitialState(definition, {
    seed: 42, seats: performers, setup: structuredClone(setup),
  });
  expect(first.challenge_order).toEqual(replay.challenge_order);
  expect(first.challenge.id).not.toBe('image-0');
});
```

- [ ] **Step 2: Add a failing application test for setup hydration**

```js
const clueHistory = { list: vi.fn(async () => [{ clue_id: 'rabbit' }, { clue_id: 'duck' }]) };
const application = new GamingApplication({ coordinator, definitions, manifestStore, clueHistory });
await application.createSession({ definitionId: 'charades:fhe', participants: [], viewer: { role: 'host' }, surfaceId: 'piano' });
expect(coordinator.create).toHaveBeenCalledWith(expect.objectContaining({
  setup: expect.objectContaining({ charades_history_ids: ['rabbit', 'duck'] }),
}));
```

Also assert a non-Charades experience does not query or receive this field.

- [ ] **Step 3: Run the focused tests and verify both fail**

Run: `npx vitest run shared/gaming/rulesets/activity-party/activityParty.test.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`

Expected: FAIL because the application has no `clueHistory` port and the ruleset ignores captured history.

- [ ] **Step 4: Hydrate setup before coordinator creation**

Add optional `clueHistory` to `GamingApplication`. After resolving the mounted
experience, for `experience.id === 'charades'` call `list(request.definitionId)`
and set:

```js
setup.charades_history_ids = history.map(entry => String(entry.clue_id));
```

In `createInitialState`, pass `setup.charades_history_ids || []` as
`historyIds`. Because `setup` is already checksummed into `session-created`, no
kernel interface change is required.

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run shared/gaming/rulesets/activity-party/activityParty.test.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit deterministic history capture**

```bash
git add shared/gaming/rulesets/activity-party/index.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs backend/src/3_applications/gaming/runtime/GamingApplication.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs
git commit -m "feat(gaming): capture charades history in session setup"
```

### Task 3: Persist committed real-play history idempotently

**Files:**
- Create: `backend/src/3_applications/gaming/ports/CharadesClueHistory.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.test.mjs`
- Modify: `backend/src/3_applications/gaming/runtime/GamingApplication.mjs:20-101`
- Modify: `backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`
- Modify: `backend/src/5_composition/modules/gamingApi.mjs:25-57`
- Modify: `backend/src/app.mjs:2177-2191`

**Interfaces:**
- Produces: `list(definitionId)`, `append(definitionId, entry)`, and `replace(definitionId, entries)`.
- Entry shape: `{ key, clue_id, session_id, challenge_index, clue_index, presentation, played_at }`.

- [ ] **Step 1: Write failing YAML adapter tests**

Test that `append` preserves insertion order, the same `key` is idempotent,
different definitions are isolated, malformed stored YAML fails closed, and
`replace('charades:fhe', entries)` leaves other definition sections intact.

```js
await store.append('charades:fhe', { key: 's:0:0', clue_id: 'rabbit' });
await store.append('charades:fhe', { key: 's:0:0', clue_id: 'wrong' });
expect(await store.list('charades:fhe')).toEqual([{ key: 's:0:0', clue_id: 'rabbit' }]);
```

- [ ] **Step 2: Run the adapter test and verify it fails to import**

Run: `npx vitest run backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.test.mjs`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement atomic YAML persistence**

Use `ensureDir`, `fileExists`, `readTextFromPath`, and `writeFileAtomic` from
`FileIO.mjs`; do not introduce direct `fs` writes. Validate `version: 1`, a
mapping of definition IDs, array entries, non-empty keys, and non-empty clue
IDs before atomically replacing `charades.yml`.

- [ ] **Step 4: Add failing application tests for committed turns and retries**

Configure `coordinator.dispatch` to return a casual Charades result with a
`challenge.finished` event and `state.challenge.id === 'rabbit'`. Assert:

```js
expect(clueHistory.append).toHaveBeenCalledWith('charades:fhe', {
  key: 'session:1:0:0', clue_id: 'rabbit', session_id: 'session:1',
  challenge_index: 0, clue_index: 0, presentation: 'image',
  played_at: '2026-09-20T12:00:00.000Z',
});
```

Assert `challenge.rewound`, `performer.ready`, competitive sessions, and other
experiences do not append. Assert a duplicate command result containing the
same committed event still calls the idempotent adapter, repairing an earlier
failed write.

- [ ] **Step 5: Run application tests and verify the record tests fail**

Run: `npx vitest run backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`

Expected: FAIL because dispatch does not persist clue history.

- [ ] **Step 6: Record the committed state before returning dispatch**

Resolve the definition ID from `result.header.artifacts.rules_definition.id`.
For a casual Charades result containing `challenge.finished`, await
`clueHistory.append(...)`. Use the event envelope's `recorded_at`; do not use a
second clock. Keep append idempotent so duplicate command retries are safe.

- [ ] **Step 7: Wire the adapter through composition**

Add `historyDir` to `createGamingApiModule`, instantiate the adapter at
`path.join(historyDir, 'charades.yml')`, pass it to `GamingApplication`, and
call composition with:

```js
historyDir: configService.getHouseholdPath('gaming/history'),
```

- [ ] **Step 8: Run adapter, application, composition, and kernel replay tests**

Run: `npx vitest run backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.test.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs shared/gaming/kernel/kernel.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit persistence and composition**

```bash
git add backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.mjs backend/src/1_adapters/persistence/yaml/gaming/YamlCharadesClueHistory.test.mjs backend/src/3_applications/gaming/ports/CharadesClueHistory.mjs backend/src/3_applications/gaming/runtime/GamingApplication.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs backend/src/5_composition/modules/gamingApi.mjs backend/src/app.mjs
git commit -m "feat(gaming): persist real charades clue history"
```

### Task 4: Seed the canonical history and certify no repeats

**Files:**
- Create: `cli/charades-history.cli.mjs`
- Create: `cli/charades-history.cli.test.mjs`
- Modify: `package.json:128-132`
- Modify: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs:135-175`
- Modify: `docs/reference/gaming/party-games.md:133-205`
- Runtime data: `{DAYLIGHT_BASE_PATH}/data/household/gaming/history/charades.yml`

**Interfaces:**
- Consumes: `reset-fhe --from-session game:4978457a-e9f0-4bee-b941-765d5daa33a6 --apply`.
- Produces: a timestamped sibling backup and exactly 18 `charades:fhe` ledger entries.

- [ ] **Step 1: Write CLI tests for dry-run, exact seed, and backup behavior**

Use a temporary data root with the canonical session fixture. Verify no write
without `--apply`; verify `--apply` writes the 18 IDs from the spec in order;
verify an existing ledger is copied to
`charades.yml.backup-YYYYMMDD-HHMMSS` before replacement.

- [ ] **Step 2: Run the CLI tests and verify they fail to import**

Run: `npx vitest run cli/charades-history.cli.test.mjs`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the narrowly scoped reset command**

The CLI must resolve data paths through the repository config service, read the
specified snapshot and its pinned content artifact, verify the session is
`complete`, `charades:fhe`, and has exactly 18 challenge indices, then generate
entries with keys `legacy:<session-id>:<turn>`. Dry-run prints target path,
backup path, and IDs. `--apply` calls the adapter's `replace` method.

- [ ] **Step 4: Add a live-flow assertion for canonical exclusion**

After session creation, assert the selected `state.challenge_order` IDs do not
intersect the 18 canonical IDs while both pools still have unused clues. Also
assert `setup.charades_history_ids` is not exposed in the player projection.

- [ ] **Step 5: Run focused unit and non-live integration tests**

Run: `npx vitest run cli/charades-history.cli.test.mjs shared/gaming/rulesets/activity-party/charadesSelection.test.mjs shared/gaming/rulesets/activity-party/activityParty.test.mjs backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run the reset dry-run against real data and inspect all 18 IDs**

Run: `node cli/charades-history.cli.mjs reset-fhe --from-session 'game:4978457a-e9f0-4bee-b941-765d5daa33a6'`

Expected: reports the configured real-data target and the exact ordered list in the spec, with no write.

- [ ] **Step 7: Apply the reviewed reset**

Run: `node cli/charades-history.cli.mjs reset-fhe --from-session 'game:4978457a-e9f0-4bee-b941-765d5daa33a6' --apply`

Expected: creates a backup when needed and writes only the 18 canonical entries for `charades:fhe`.

- [ ] **Step 8: Update documentation and run the live flow against the single existing stack**

Document the ledger, pool exhaustion semantics, reset command, and distinction
between play history and replay journals. Per `CLAUDE.local.md`, do not start a
second backend; run the HTTPS live test only against the one authorized stack:

Run: `npx playwright test tests/live/flow/gaming/fhe-charades.runtime.test.mjs`

Expected: PASS; the new session excludes canonical history and completes 18 turns.

- [ ] **Step 9: Commit the reset tooling, certification, and docs**

```bash
git add cli/charades-history.cli.mjs cli/charades-history.cli.test.mjs package.json tests/live/flow/gaming/fhe-charades.runtime.test.mjs docs/reference/gaming/party-games.md
git commit -m "chore(gaming): seed canonical FHE charades history"
```
