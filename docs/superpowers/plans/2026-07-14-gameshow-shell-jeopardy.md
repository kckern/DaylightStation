# Game Show Shell + Jeopardy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-14-gameshow-shell-jeopardy-design.md` — read it first.

**Goal:** A generic Game Show shell module (teams, buzzers, scoreboard, timers, audio) in the screen framework, with Jeopardy as its first fully playable game.

**Architecture:** Frontend-authoritative game state machine (React reducers) inside `frontend/src/modules/GameShow/`, checkpointed to a backend session store after every transition. Backend serves config (household `gameshow.yml`, team presets hydrated via UserService), validated game-set content from `data/content/games/jeopardy/`, and relays MQTT buzzer events to the frontend over the existing WebSocket event bus. Shell code never mentions boards/clues/categories; Jeopardy-specific logic lives in `games/Jeopardy/`.

**Tech Stack:** React 18 (JSX, no TS), Express 5, vitest (+ supertest for routers), js-yaml via `#system/utils` FileIO, existing `MQTTSelectorAdapter`, existing WS event bus (`broadcastEvent` / `useWebSocketSubscription`).

## Global Constraints

- Plain JavaScript everywhere — no TypeScript syntax.
- Backend imports use aliases: `#system/*`, `#domains/*`, `#apps/*`, `#adapters/*`, `#api/*`.
- ALL backend file I/O goes through `#system/utils` (`loadYamlSafe`, `saveYaml`, `listYamlFiles`, `ensureDir`, …) — never raw `fs` outside FileIO.
- Household config is read with `configService.getHouseholdAppConfig(householdId, 'gameshow')` — NOT `getAppConfig` (silent-null gotcha).
- New v1 routers MUST be added to `routeMap` in `backend/src/4_api/v1/routers/api.mjs` AND constructed in `backend/src/app.mjs` (`v1Routers.gameshow = …`). Routers are not auto-discovered.
- Backend router tests: colocated `*.test.mjs`, `// @vitest-environment node`, supertest. Frontend state tests: colocated `*.test.js` (pure reducers/hooks logic — no DOM needed where avoidable).
- Run tests with `npx vitest run <path>`; expected PASS/FAIL noted per step.
- Shell hard rule: files under `frontend/src/modules/GameShow/shell/` must not contain the words board, clue, or category in any identifier.
- WS payload contract (backend → frontend): `{ topic: 'gameshow', kind: 'buzz', buzzerId, action, slot, ts }`.
- Commit after every task (small, working commits). Do not deploy; another agent/human handles deployment.

## File Map (created/modified across all tasks)

**Backend**
- Create `backend/src/2_domains/gameshow/gameSetValidation.mjs` (+ test) — pure game-set validator
- Create `backend/src/3_applications/gameshow/GameShowSessionStore.mjs` (+ test) — YAML session persistence
- Create `backend/src/3_applications/gameshow/GameShowService.mjs` (+ test) — config merge, preset hydration, set listing
- Create `backend/src/4_api/v1/routers/gameshow.mjs` (+ test) — REST surface + buzz inject
- Modify `backend/src/4_api/v1/routers/api.mjs` — routeMap entry
- Modify `backend/src/app.mjs` — router construction + buzzer MQTT wiring

**Frontend (all under `frontend/src/modules/GameShow/`)**
- `GameShow.jsx`, `index.js`, `GameShow.scss` — shell root + registration
- `shell/flow/flowReducer.js` (+ test) — outer flow state machine
- `shell/session/useSessionCheckpoint.js` (+ test) — checkpoint/resume client
- `shell/buzzers/useBuzzers.js` (+ test) — WS buzz events, arbitration, bind, fallback keys
- `shell/scoreboard/scoreReducer.js` (+ test), `shell/scoreboard/Scoreboard.jsx`
- `shell/audio/AudioCueEngine.js` (+ test), `shell/timers/useCountdown.js` (+ test), `shell/timers/TimerRing.jsx`
- `shell/teams/teamSetupReducer.js` (+ test), `shell/teams/TeamSetup.jsx`
- `shell/components/` — TitleCard, TeamBadge, RevealPanel, MediaCluePlayer, WagerPanel, ControlLegend
- `games/registry.js`
- `games/Jeopardy/jeopardyReducer.js` (+ test), `games/Jeopardy/keymap.js` (+ test)
- `games/Jeopardy/Jeopardy.jsx`, `games/Jeopardy/Board.jsx`, `games/Jeopardy/ClueScreen.jsx`, `games/Jeopardy/FinalRound.jsx`, `games/Jeopardy/Results.jsx`, `games/Jeopardy/Jeopardy.scss`
- Modify `frontend/src/screen-framework/widgets/builtins.js` — register `gameshow`

**Content/docs**
- `tests/_fixtures/gameshow/valid-set.yml`, `tests/_fixtures/gameshow/invalid-set.yml`
- `docs/reference/gameshow/README.md` (schemas, AI game-set generation prompt, sound-pack manifest format, sample `gameshow.yml`)

---

# Phase 1 — Backend foundation

### Task 1: Game-set validation (pure domain)

**Files:**
- Create: `backend/src/2_domains/gameshow/gameSetValidation.mjs`
- Test: `backend/src/2_domains/gameshow/gameSetValidation.test.mjs`

**Interfaces:**
- Produces: `validateGameSet(raw) → { valid: boolean, errors: string[], set: object|null }`. `set` is the normalized game set (defaults applied: `multiplier: 1`, `mode: 'hosted'`, `penalize_wrong: true`, `daily_double: false`, `media: null`, `final: null`). Later tasks (Task 3 service, Task 4 router) rely on this exact shape.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/2_domains/gameshow/gameSetValidation.test.mjs
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateGameSet } from './gameSetValidation.mjs';

const goodSet = {
  id: 'test-set',
  title: 'Test Night',
  rounds: [
    {
      name: 'Jeopardy',
      mode: 'hosted',
      categories: [
        {
          name: 'Old Testament',
          clues: [
            { value: 100, clue: 'He built an ark', answer: 'Who is Noah?' },
            { value: 200, clue: 'Name this location', answer: 'What is Sinai?', media: { type: 'image', src: 'games/jeopardy/test/sinai.jpg' }, daily_double: true },
          ],
        },
      ],
    },
  ],
  final: { category: 'Prophets', clue: 'Swallowed by a fish', answer: 'Who is Jonah?' },
};

describe('validateGameSet', () => {
  it('accepts a valid set and normalizes defaults', () => {
    const { valid, errors, set } = validateGameSet(goodSet);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
    expect(set.rounds[0].multiplier).toBe(1);
    expect(set.rounds[0].penalize_wrong).toBe(true);
    expect(set.rounds[0].categories[0].clues[0].daily_double).toBe(false);
    expect(set.rounds[0].categories[0].clues[0].media).toBe(null);
    expect(set.rounds[0].categories[0].clues[1].daily_double).toBe(true);
  });

  it('normalizes a set without final to final: null', () => {
    const { final, ...noFinal } = goodSet;
    const { valid, set } = validateGameSet(noFinal);
    expect(valid).toBe(true);
    expect(set.final).toBe(null);
  });

  it('rejects non-object input', () => {
    expect(validateGameSet(null).valid).toBe(false);
    expect(validateGameSet('nope').valid).toBe(false);
  });

  it('rejects missing id/title/rounds', () => {
    const { valid, errors } = validateGameSet({});
    expect(valid).toBe(false);
    expect(errors.join(' ')).toMatch(/id/);
    expect(errors.join(' ')).toMatch(/title/);
    expect(errors.join(' ')).toMatch(/rounds/);
  });

  it('rejects bad round mode and bad media type with clue coordinates in the message', () => {
    const bad = JSON.parse(JSON.stringify(goodSet));
    bad.rounds[0].mode = 'karaoke';
    bad.rounds[0].categories[0].clues[0].media = { type: 'hologram', src: 'x' };
    const { valid, errors } = validateGameSet(bad);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('karaoke'))).toBe(true);
    expect(errors.some((e) => e.includes('rounds[0].categories[0].clues[0]'))).toBe(true);
  });

  it('rejects clues missing value/clue/answer', () => {
    const bad = JSON.parse(JSON.stringify(goodSet));
    delete bad.rounds[0].categories[0].clues[0].answer;
    bad.rounds[0].categories[0].clues[1].value = 'lots';
    const { valid, errors } = validateGameSet(bad);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/2_domains/gameshow/gameSetValidation.test.mjs`
Expected: FAIL — cannot find module `./gameSetValidation.mjs`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/2_domains/gameshow/gameSetValidation.mjs
/**
 * Pure validation + normalization for game-show content sets
 * (data/content/games/<game>/<set-id>.yml). No I/O — callers load YAML
 * and pass the parsed object.
 *
 * Normalized shape (returned as `set` when valid):
 *   { id, title, description, rounds: [{ name, mode, multiplier,
 *     timer_seconds|null, penalize_wrong, categories: [{ name,
 *     clues: [{ value, clue, answer, media|null, daily_double }] }] }],
 *     final: { category, clue, answer, media|null } | null }
 */

const MODES = ['hosted', 'self', 'turns'];
const MEDIA_TYPES = ['image', 'audio', 'video'];

function normalizeMedia(media, path, errors) {
  if (media == null) return null;
  if (typeof media !== 'object') {
    errors.push(`${path}.media must be an object`);
    return null;
  }
  if (!MEDIA_TYPES.includes(media.type)) {
    errors.push(`${path}.media.type must be one of ${MEDIA_TYPES.join('|')} (got "${media.type}")`);
    return null;
  }
  if (typeof media.src !== 'string' || !media.src) {
    errors.push(`${path}.media.src is required`);
    return null;
  }
  return { type: media.type, src: media.src };
}

function normalizeClue(clue, path, errors) {
  if (clue == null || typeof clue !== 'object') {
    errors.push(`${path} must be an object`);
    return null;
  }
  if (typeof clue.value !== 'number' || clue.value <= 0) {
    errors.push(`${path}.value must be a positive number`);
  }
  if (typeof clue.clue !== 'string' || !clue.clue) {
    errors.push(`${path}.clue is required`);
  }
  if (typeof clue.answer !== 'string' || !clue.answer) {
    errors.push(`${path}.answer is required`);
  }
  return {
    value: clue.value,
    clue: clue.clue,
    answer: clue.answer,
    media: normalizeMedia(clue.media, path, errors),
    daily_double: clue.daily_double === true,
  };
}

export function validateGameSet(raw) {
  const errors = [];
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['game set must be a mapping/object'], set: null };
  }
  if (typeof raw.id !== 'string' || !raw.id) errors.push('id is required');
  if (typeof raw.title !== 'string' || !raw.title) errors.push('title is required');
  if (!Array.isArray(raw.rounds) || raw.rounds.length === 0) errors.push('rounds must be a non-empty array');

  const rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).map((round, r) => {
    const rPath = `rounds[${r}]`;
    if (round == null || typeof round !== 'object') {
      errors.push(`${rPath} must be an object`);
      return null;
    }
    const mode = round.mode ?? 'hosted';
    if (!MODES.includes(mode)) {
      errors.push(`${rPath}.mode must be one of ${MODES.join('|')} (got "${mode}")`);
    }
    if (!Array.isArray(round.categories) || round.categories.length === 0) {
      errors.push(`${rPath}.categories must be a non-empty array`);
    }
    const categories = (Array.isArray(round.categories) ? round.categories : []).map((cat, c) => {
      const cPath = `${rPath}.categories[${c}]`;
      if (cat == null || typeof cat !== 'object' || typeof cat.name !== 'string' || !cat.name) {
        errors.push(`${cPath}.name is required`);
        return null;
      }
      if (!Array.isArray(cat.clues) || cat.clues.length === 0) {
        errors.push(`${cPath}.clues must be a non-empty array`);
        return { name: cat.name, clues: [] };
      }
      return {
        name: cat.name,
        clues: cat.clues.map((clue, i) => normalizeClue(clue, `${cPath}.clues[${i}]`, errors)),
      };
    });
    return {
      name: typeof round.name === 'string' && round.name ? round.name : `Round ${r + 1}`,
      mode,
      multiplier: typeof round.multiplier === 'number' && round.multiplier > 0 ? round.multiplier : 1,
      timer_seconds: typeof round.timer_seconds === 'number' ? round.timer_seconds : null,
      penalize_wrong: round.penalize_wrong !== false,
      categories,
    };
  });

  let final = null;
  if (raw.final != null) {
    const f = raw.final;
    if (typeof f !== 'object' || typeof f.category !== 'string' || typeof f.clue !== 'string' || typeof f.answer !== 'string') {
      errors.push('final requires category, clue, and answer strings');
    } else {
      final = { category: f.category, clue: f.clue, answer: f.answer, media: normalizeMedia(f.media, 'final', errors) };
    }
  }

  if (errors.length > 0) return { valid: false, errors, set: null };
  return {
    valid: true,
    errors: [],
    set: {
      id: raw.id,
      title: raw.title,
      description: typeof raw.description === 'string' ? raw.description : '',
      rounds,
      final,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/2_domains/gameshow/gameSetValidation.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/gameshow/
git commit -m "feat(gameshow): game-set validation domain module"
```

### Task 2: Session store (YAML persistence)

**Files:**
- Create: `backend/src/3_applications/gameshow/GameShowSessionStore.mjs`
- Test: `backend/src/3_applications/gameshow/GameShowSessionStore.test.mjs`

**Interfaces:**
- Consumes: `#system/utils` FileIO (`loadYamlSafe`, `saveYaml`, `listYamlFiles`, `ensureDir`).
- Produces: class `GameShowSessionStore({ sessionsDir, logger })` with:
  - `create({ game, setId, teams }) → session` — session: `{ id, game, setId, teams, state: null, status: 'active', created, updated }` (ISO timestamps; id format `gs_<epoch-ms>`)
  - `get(id) → session|null`
  - `getActive() → session|null` (most recently updated `status: 'active'`)
  - `checkpoint(id, state) → session|null` — replaces `state` (opaque frontend snapshot), bumps `updated`
  - `finish(id) → session|null` — sets `status: 'complete'`
  - Task 4's router calls exactly these methods.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/3_applications/gameshow/GameShowSessionStore.test.mjs
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameShowSessionStore } from './GameShowSessionStore.mjs';

const NOOP = { info() {}, warn() {}, error() {}, debug() {} };
const TEAMS = [
  { id: 'team_1', name: 'Kids', color: '#e6b325', slot: 'slot_1', members: [{ id: 'felix', name: 'Felix' }] },
  { id: 'team_2', name: 'Parents', color: '#3273dc', slot: 'slot_2', members: [{ id: 'kckern', name: 'KC' }] },
];

describe('GameShowSessionStore', () => {
  let store;
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-sessions-'));
    store = new GameShowSessionStore({ sessionsDir: dir, logger: NOOP });
  });

  it('creates a session with active status and null state', () => {
    const s = store.create({ game: 'jeopardy', setId: 'test-set', teams: TEAMS });
    expect(s.id).toMatch(/^gs_\d+$/);
    expect(s.status).toBe('active');
    expect(s.state).toBe(null);
    expect(store.get(s.id).teams).toHaveLength(2);
  });

  it('checkpoints replace state and survive a fresh store instance (disk round-trip)', () => {
    const s = store.create({ game: 'jeopardy', setId: 'test-set', teams: TEAMS });
    store.checkpoint(s.id, { phase: 'playing', scores: { team_1: 400 } });
    const reloaded = new GameShowSessionStore({ sessionsDir: store.sessionsDir, logger: NOOP });
    expect(reloaded.get(s.id).state.scores.team_1).toBe(400);
  });

  it('getActive returns the most recently updated active session, ignoring finished ones', () => {
    const a = store.create({ game: 'jeopardy', setId: 'a', teams: TEAMS });
    const b = store.create({ game: 'jeopardy', setId: 'b', teams: TEAMS });
    store.checkpoint(a.id, { phase: 'playing' }); // a now newest
    expect(store.getActive().id).toBe(a.id);
    store.finish(a.id);
    expect(store.getActive().id).toBe(b.id);
    store.finish(b.id);
    expect(store.getActive()).toBe(null);
  });

  it('returns null for unknown ids', () => {
    expect(store.get('gs_0')).toBe(null);
    expect(store.checkpoint('gs_0', {})).toBe(null);
    expect(store.finish('gs_0')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/gameshow/GameShowSessionStore.test.mjs`
Expected: FAIL — cannot find module `./GameShowSessionStore.mjs`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/3_applications/gameshow/GameShowSessionStore.mjs
/**
 * GameShowSessionStore - YAML persistence for game-show sessions.
 *
 * One file per session at <sessionsDir>/<id>.yml. The `state` field is an
 * opaque frontend snapshot (hybrid model: frontend is authoritative during
 * play, this store is the crash/resume checkpoint).
 */
import path from 'path';
import { loadYamlSafe, saveYaml, listYamlFiles, ensureDir } from '#system/utils/index.mjs';

export class GameShowSessionStore {
  constructor({ sessionsDir, logger = console }) {
    this.sessionsDir = sessionsDir;
    this.logger = logger;
    ensureDir(this.sessionsDir);
  }

  #file(id) {
    // ids are generated by this class (gs_<digits>) — reject anything else
    if (!/^gs_\d+$/.test(String(id))) return null;
    return path.join(this.sessionsDir, String(id));
  }

  #save(session) {
    saveYaml(this.#file(session.id), session);
    return session;
  }

  create({ game, setId, teams }) {
    const now = new Date();
    const session = {
      id: `gs_${now.getTime()}`,
      game,
      setId,
      teams: teams || [],
      state: null,
      status: 'active',
      created: now.toISOString(),
      updated: now.toISOString(),
    };
    this.logger.info?.('gameshow.session.created', { id: session.id, game, setId });
    return this.#save(session);
  }

  get(id) {
    const file = this.#file(id);
    if (!file) return null;
    return loadYamlSafe(file) || null;
  }

  getActive() {
    // listYamlFiles strips extensions by default (see FileIO.mjs)
    const names = listYamlFiles(this.sessionsDir) || [];
    let newest = null;
    for (const name of names) {
      const s = loadYamlSafe(path.join(this.sessionsDir, name));
      if (s?.status === 'active' && (!newest || s.updated > newest.updated)) newest = s;
    }
    return newest;
  }

  checkpoint(id, state) {
    const session = this.get(id);
    if (!session) return null;
    session.state = state ?? null;
    session.updated = new Date().toISOString();
    return this.#save(session);
  }

  finish(id) {
    const session = this.get(id);
    if (!session) return null;
    session.status = 'complete';
    session.updated = new Date().toISOString();
    this.logger.info?.('gameshow.session.finished', { id });
    return this.#save(session);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/gameshow/GameShowSessionStore.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/gameshow/GameShowSessionStore.*
git commit -m "feat(gameshow): YAML session store with checkpoint/resume"
```

### Task 3: GameShowService (config merge, preset hydration, set listing)

**Files:**
- Create: `backend/src/3_applications/gameshow/GameShowService.mjs`
- Test: `backend/src/3_applications/gameshow/GameShowService.test.mjs`
- Create fixtures: `tests/_fixtures/gameshow/valid-set.yml`, `tests/_fixtures/gameshow/invalid-set.yml`

**Interfaces:**
- Consumes: Task 1 `validateGameSet(raw)`; `configService.getHouseholdAppConfig(null, 'gameshow')`, `configService.getDataDir()`; `userService.getProfile(username)` / `resolveDisplayName(userId)` (see `backend/src/0_system/config/UserService.mjs`).
- Produces: class `GameShowService({ configService, userService, logger })` with:
  - `getConfig() → { buzzers: [], team_presets: [hydrated], defaults: { timer_seconds, mute }, sounds: { pack } }` — preset members hydrated to `{ id, name, avatar }` (avatar = `/api/v1/static/users/<id>`; unknown usernames pass through as `{ id, name: id, avatar: null }`)
  - `listSets(game) → [{ id, title, description, roundCount, valid, error }]` (error = first validation message when invalid)
  - `getSet(game, setId) → normalized set` or throws `Error('set not found: …')` / `Error('invalid set: …')`
  - Content dir: `<dataDir>/content/games/<game>/` — game name must match `/^[a-z0-9-]+$/` (reject traversal).

- [ ] **Step 1: Write the fixtures**

```yaml
# tests/_fixtures/gameshow/valid-set.yml
id: valid-set
title: "Fixture Night"
description: "Test fixture"
rounds:
  - name: Jeopardy
    mode: hosted
    multiplier: 1
    categories:
      - name: "Numbers"
        clues:
          - value: 100
            clue: "2+2"
            answer: "What is 4?"
          - value: 200
            clue: "Name that tune"
            answer: "What is Ode to Joy?"
            media: { type: audio, src: "games/jeopardy/fixture/ode.mp3" }
            daily_double: true
final:
  category: "Finale"
  clue: "The last clue"
  answer: "What is the end?"
```

```yaml
# tests/_fixtures/gameshow/invalid-set.yml
id: invalid-set
title: "Broken"
rounds:
  - mode: karaoke
    categories: []
```

- [ ] **Step 2: Write the failing test**

```js
// backend/src/3_applications/gameshow/GameShowService.test.mjs
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameShowService } from './GameShowService.mjs';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../tests/_fixtures/gameshow');
const NOOP = { info() {}, warn() {}, error() {}, debug() {} };

const HOUSEHOLD_CFG = {
  buzzers: [{ id: 'living_room', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', buttons: { '1_single': 'slot_1' } }],
  team_presets: [
    { id: 'kids_vs_parents', name: 'Kids vs Parents', teams: [
      { name: 'Kids', color: '#e6b325', members: ['felix'] },
      { name: 'Parents', color: '#3273dc', members: ['kckern', 'ghost_user'] },
    ] },
  ],
  defaults: { timer_seconds: 15 },
  sounds: { pack: 'classic' },
};

function makeService({ cfg = HOUSEHOLD_CFG, dataDir } = {}) {
  const configService = {
    getHouseholdAppConfig: () => cfg,
    getDataDir: () => dataDir,
  };
  const userService = {
    getProfile: (u) => (u === 'ghost_user' ? null : { username: u, display_name: u.toUpperCase() }),
  };
  return new GameShowService({ configService, userService, logger: NOOP });
}

describe('GameShowService', () => {
  let dataDir;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-data-'));
    const setsDir = path.join(dataDir, 'content/games/jeopardy');
    fs.mkdirSync(setsDir, { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, 'valid-set.yml'), path.join(setsDir, 'valid-set.yml'));
    fs.copyFileSync(path.join(FIXTURES, 'invalid-set.yml'), path.join(setsDir, 'invalid-set.yml'));
  });

  it('getConfig hydrates preset members via userService and applies defaults', () => {
    const cfg = makeService({ dataDir }).getConfig();
    expect(cfg.team_presets[0].teams[0].members[0]).toEqual(
      { id: 'felix', name: 'FELIX', avatar: '/api/v1/static/users/felix' });
    // unknown user passes through, no avatar
    expect(cfg.team_presets[0].teams[1].members[1]).toEqual(
      { id: 'ghost_user', name: 'ghost_user', avatar: null });
    expect(cfg.defaults.timer_seconds).toBe(15);
    expect(cfg.defaults.mute).toBe(false);
    expect(cfg.buzzers).toHaveLength(1);
  });

  it('getConfig tolerates a missing household config', () => {
    const cfg = makeService({ cfg: null, dataDir }).getConfig();
    expect(cfg.buzzers).toEqual([]);
    expect(cfg.team_presets).toEqual([]);
    expect(cfg.defaults.timer_seconds).toBe(12);
    expect(cfg.sounds.pack).toBe('classic');
  });

  it('listSets reports valid and invalid sets without throwing', () => {
    const sets = makeService({ dataDir }).listSets('jeopardy');
    const valid = sets.find((s) => s.id === 'valid-set');
    const invalid = sets.find((s) => s.id === 'invalid-set');
    expect(valid).toMatchObject({ title: 'Fixture Night', roundCount: 1, valid: true, error: null });
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toMatch(/karaoke|categories/);
  });

  it('getSet returns the normalized set; throws on missing/invalid', () => {
    const svc = makeService({ dataDir });
    const set = svc.getSet('jeopardy', 'valid-set');
    expect(set.rounds[0].categories[0].clues[1].daily_double).toBe(true);
    expect(() => svc.getSet('jeopardy', 'nope')).toThrow(/not found/);
    expect(() => svc.getSet('jeopardy', 'invalid-set')).toThrow(/invalid/);
    expect(() => svc.getSet('../../etc', 'x')).toThrow(/game/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/gameshow/GameShowService.test.mjs`
Expected: FAIL — cannot find module `./GameShowService.mjs`

- [ ] **Step 4: Write the implementation**

```js
// backend/src/3_applications/gameshow/GameShowService.mjs
/**
 * GameShowService - config + content for the game-show shell.
 *
 * - getConfig(): household gameshow.yml merged with defaults; team-preset
 *   members hydrated to { id, name, avatar } via UserService.
 * - listSets(game)/getSet(game, id): game-set YAML files from
 *   <dataDir>/content/games/<game>/, validated via the gameshow domain.
 */
import path from 'path';
import { loadYamlSafe, listYamlFiles } from '#system/utils/index.mjs';
import { validateGameSet } from '#domains/gameshow/gameSetValidation.mjs';

const GAME_NAME_RE = /^[a-z0-9-]+$/;

export class GameShowService {
  constructor({ configService, userService, logger = console }) {
    this.configService = configService;
    this.userService = userService;
    this.logger = logger;
  }

  #hydrateMember(username) {
    const profile = this.userService.getProfile(username);
    if (!profile) {
      this.logger.warn?.('gameshow.preset.unknown_user', { username });
      return { id: username, name: username, avatar: null };
    }
    const id = profile.username || username;
    return {
      id,
      name: profile.display_name || id,
      avatar: `/api/v1/static/users/${id}`,
    };
  }

  getConfig() {
    const raw = this.configService.getHouseholdAppConfig(null, 'gameshow') || {};
    const presets = (raw.team_presets || []).map((preset) => ({
      id: preset.id,
      name: preset.name || preset.id,
      teams: (preset.teams || []).map((team, i) => ({
        name: team.name || `Team ${i + 1}`,
        color: team.color || null,
        members: (team.members || []).map((m) => this.#hydrateMember(String(m))),
      })),
    }));
    return {
      buzzers: raw.buzzers || [],
      team_presets: presets,
      defaults: {
        timer_seconds: raw.defaults?.timer_seconds ?? 12,
        mute: raw.defaults?.mute ?? false,
      },
      sounds: { pack: raw.sounds?.pack || 'classic' },
    };
  }

  #setsDir(game) {
    if (!GAME_NAME_RE.test(String(game))) throw new Error(`invalid game name: ${game}`);
    return path.join(this.configService.getDataDir(), 'content', 'games', String(game));
  }

  listSets(game) {
    const dir = this.#setsDir(game);
    const names = listYamlFiles(dir) || [];
    return names.map((name) => {
      const raw = loadYamlSafe(path.join(dir, name));
      const { valid, errors, set } = validateGameSet(raw);
      return valid
        ? { id: set.id, title: set.title, description: set.description, roundCount: set.rounds.length, valid: true, error: null }
        : { id: name, title: name, description: '', roundCount: 0, valid: false, error: errors[0] || 'invalid' };
    });
  }

  getSet(game, setId) {
    const dir = this.#setsDir(game);
    if (!GAME_NAME_RE.test(String(setId))) throw new Error(`set not found: ${setId}`);
    const raw = loadYamlSafe(path.join(dir, String(setId)));
    if (!raw) throw new Error(`set not found: ${setId}`);
    const { valid, errors, set } = validateGameSet(raw);
    if (!valid) throw new Error(`invalid set ${setId}: ${errors[0]}`);
    return set;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/gameshow/GameShowService.test.mjs`
Expected: PASS (4 tests). Note: `valid-set` fixture ids match their filenames (`invalid-set` uses filename as fallback id).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/gameshow/GameShowService.* tests/_fixtures/gameshow/
git commit -m "feat(gameshow): GameShowService — config hydration + game-set listing"
```

### Task 4: REST router + wiring into api.mjs/app.mjs

**Files:**
- Create: `backend/src/4_api/v1/routers/gameshow.mjs`
- Test: `backend/src/4_api/v1/routers/gameshow.test.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs` (routeMap — one line)
- Modify: `backend/src/app.mjs` (construct router; find the block near `v1Routers.feedback = createFeedbackRouter({ … })` at ~line 1427 and add the gameshow block after it)

**Interfaces:**
- Consumes: Task 2 store (`create/get/getActive/checkpoint/finish`), Task 3 service (`getConfig/listSets/getSet`), and a `broadcastEvent` function (same one app.mjs imports at line ~61) for buzz injection.
- Produces HTTP surface (all under `/api/v1/gameshow`):
  - `GET /config`, `GET /games`, `GET /games/:game/sets`, `GET /games/:game/sets/:setId`
  - `POST /sessions` (body `{ game, setId, teams }`) → 201 session
  - `GET /sessions/active` → `{ session: session|null }`
  - `POST /sessions/:id/checkpoint` (body `{ state }`) → session
  - `POST /sessions/:id/finish` → session
  - `POST /buzz` (body `{ slot, buzzerId?, action? }`) → 202; side-effect: `broadcastEvent({ topic: 'gameshow', kind: 'buzz', buzzerId: buzzerId||'debug', action: action||'inject', slot, ts })`
  - `GET /media/*splat` → sendFile from `<mediaAppsDir>/<splat>` with path-containment (404 outside). Raw `/media/*` is NOT served by the app (known gotcha — all frontend assets go through `/api/v1/*`), so game sounds and clue media are served here. Router takes a `mediaAppsDir` param; app.mjs passes `path.join(configService.getMediaDir(), 'apps')`. Use `splatPath` from `#api/utils/wildcard.mjs` (Express 5 `*splat` — same as static.mjs).
- Frontend Tasks 7–8 call exactly these paths via `DaylightAPI`; Tasks 10/12 build media URLs as `/api/v1/gameshow/media/<relative-path>`.
- (Spec §8 sketches `GET /sessions?active=true`; implemented as `GET /sessions/active` — same semantics, cleaner route.)

- [ ] **Step 1: Write the failing test**

```js
// backend/src/4_api/v1/routers/gameshow.test.mjs
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createGameshowRouter } from './gameshow.mjs';

const NOOP = { info() {}, warn() {}, error() {}, debug() {} };

// temp media dir with one real file for the /media route
import fs from 'fs';
import os from 'os';
import path from 'path';
const mediaAppsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameshow-media-'));
fs.mkdirSync(path.join(mediaAppsDir, 'gameshow/classic'), { recursive: true });
fs.writeFileSync(path.join(mediaAppsDir, 'gameshow/classic/correct.mp3'), 'fake-mp3');

function makeApp() {
  const service = {
    getConfig: vi.fn(() => ({ buzzers: [], team_presets: [], defaults: { timer_seconds: 12, mute: false }, sounds: { pack: 'classic' } })),
    listSets: vi.fn(() => [{ id: 's1', title: 'Set One', description: '', roundCount: 2, valid: true, error: null }]),
    getSet: vi.fn((game, id) => {
      if (id !== 's1') throw new Error(`set not found: ${id}`);
      return { id: 's1', title: 'Set One', rounds: [], final: null };
    }),
  };
  const sessions = new Map();
  const store = {
    create: vi.fn(({ game, setId, teams }) => {
      const s = { id: 'gs_1', game, setId, teams, state: null, status: 'active', created: 'x', updated: 'x' };
      sessions.set(s.id, s);
      return s;
    }),
    getActive: vi.fn(() => [...sessions.values()].find((s) => s.status === 'active') || null),
    checkpoint: vi.fn((id, state) => {
      const s = sessions.get(id);
      if (!s) return null;
      s.state = state;
      return s;
    }),
    finish: vi.fn((id) => {
      const s = sessions.get(id);
      if (!s) return null;
      s.status = 'complete';
      return s;
    }),
  };
  const broadcastEvent = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/gameshow', createGameshowRouter({ gameShowService: service, sessionStore: store, broadcastEvent, mediaAppsDir, logger: NOOP }));
  return { app, service, store, broadcastEvent };
}

describe('gameshow router', () => {
  let ctx;
  beforeEach(() => { ctx = makeApp(); });

  it('GET /config returns service config', async () => {
    const res = await request(ctx.app).get('/gameshow/config');
    expect(res.status).toBe(200);
    expect(res.body.defaults.timer_seconds).toBe(12);
  });

  it('GET /games lists registered games', async () => {
    const res = await request(ctx.app).get('/gameshow/games');
    expect(res.status).toBe(200);
    expect(res.body.games).toEqual([{ id: 'jeopardy', title: 'Jeopardy' }]);
  });

  it('GET /games/:game/sets and /sets/:setId', async () => {
    const list = await request(ctx.app).get('/gameshow/games/jeopardy/sets');
    expect(list.body.sets[0].id).toBe('s1');
    const one = await request(ctx.app).get('/gameshow/games/jeopardy/sets/s1');
    expect(one.body.title).toBe('Set One');
    const missing = await request(ctx.app).get('/gameshow/games/jeopardy/sets/nope');
    expect(missing.status).toBe(404);
  });

  it('session lifecycle: create → active → checkpoint → finish', async () => {
    const created = await request(ctx.app).post('/gameshow/sessions')
      .send({ game: 'jeopardy', setId: 's1', teams: [{ id: 'team_1' }] });
    expect(created.status).toBe(201);
    const active = await request(ctx.app).get('/gameshow/sessions/active');
    expect(active.body.session.id).toBe('gs_1');
    const ck = await request(ctx.app).post('/gameshow/sessions/gs_1/checkpoint').send({ state: { phase: 'playing' } });
    expect(ck.body.state.phase).toBe('playing');
    const fin = await request(ctx.app).post('/gameshow/sessions/gs_1/finish');
    expect(fin.body.status).toBe('complete');
    const after = await request(ctx.app).get('/gameshow/sessions/active');
    expect(after.body.session).toBe(null);
  });

  it('POST /sessions requires game+setId', async () => {
    const res = await request(ctx.app).post('/gameshow/sessions').send({});
    expect(res.status).toBe(400);
  });

  it('checkpoint on unknown session → 404', async () => {
    const res = await request(ctx.app).post('/gameshow/sessions/gs_99/checkpoint').send({ state: {} });
    expect(res.status).toBe(404);
  });

  it('POST /buzz broadcasts a gameshow buzz event', async () => {
    const res = await request(ctx.app).post('/gameshow/buzz').send({ slot: 'slot_2' });
    expect(res.status).toBe(202);
    expect(ctx.broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gameshow', kind: 'buzz', slot: 'slot_2', buzzerId: 'debug', action: 'inject',
    }));
    const bad = await request(ctx.app).post('/gameshow/buzz').send({});
    expect(bad.status).toBe(400);
  });

  it('GET /media/* serves files from mediaAppsDir and blocks traversal', async () => {
    const ok = await request(ctx.app).get('/gameshow/media/gameshow/classic/correct.mp3');
    expect(ok.status).toBe(200);
    const missing = await request(ctx.app).get('/gameshow/media/gameshow/classic/nope.mp3');
    expect(missing.status).toBe(404);
    const traversal = await request(ctx.app).get('/gameshow/media/..%2F..%2Fetc%2Fpasswd');
    expect(traversal.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/4_api/v1/routers/gameshow.test.mjs`
Expected: FAIL — cannot find module `./gameshow.mjs`

- [ ] **Step 3: Write the router**

```js
// backend/src/4_api/v1/routers/gameshow.mjs
import express from 'express';
import path from 'path';
import { splatPath } from '#api/utils/wildcard.mjs';

/**
 * Game Show API (mounted at /api/v1/gameshow).
 *
 *   GET  /config                    → merged gameshow.yml (presets hydrated)
 *   GET  /games                     → registered game types
 *   GET  /games/:game/sets          → { sets: [...] } incl. validation status
 *   GET  /games/:game/sets/:setId   → normalized game set (404 unknown, 422 invalid)
 *   POST /sessions                  → create ({ game, setId, teams }) → 201
 *   GET  /sessions/active           → { session } (null when none)
 *   POST /sessions/:id/checkpoint   → persist frontend snapshot ({ state })
 *   POST /sessions/:id/finish       → mark complete
 *   POST /buzz                      → debug buzz inject → WS broadcast (202)
 *   GET  /media/*splat              → sound packs + clue media from media/apps/
 */
const GAMES = [{ id: 'jeopardy', title: 'Jeopardy' }];

export function createGameshowRouter({ gameShowService, sessionStore, broadcastEvent, mediaAppsDir = null, logger = console }) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    try {
      res.json(gameShowService.getConfig());
    } catch (err) {
      logger.error?.('gameshow.config.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/games', (req, res) => res.json({ games: GAMES }));

  router.get('/games/:game/sets', (req, res) => {
    try {
      res.json({ sets: gameShowService.listSets(req.params.game) });
    } catch (err) {
      logger.error?.('gameshow.sets.error', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/games/:game/sets/:setId', (req, res) => {
    try {
      res.json(gameShowService.getSet(req.params.game, req.params.setId));
    } catch (err) {
      const code = /not found/.test(err.message) ? 404 : 422;
      res.status(code).json({ error: err.message });
    }
  });

  router.post('/sessions', (req, res) => {
    const { game, setId, teams } = req.body || {};
    if (!game || !setId) return res.status(400).json({ error: 'game and setId required' });
    res.status(201).json(sessionStore.create({ game, setId, teams: teams || [] }));
  });

  router.get('/sessions/active', (req, res) => {
    res.json({ session: sessionStore.getActive() });
  });

  router.post('/sessions/:id/checkpoint', (req, res) => {
    const session = sessionStore.checkpoint(req.params.id, (req.body || {}).state ?? null);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  router.post('/sessions/:id/finish', (req, res) => {
    const session = sessionStore.finish(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  router.post('/buzz', (req, res) => {
    const { slot, buzzerId, action } = req.body || {};
    if (!slot) return res.status(400).json({ error: 'slot required' });
    broadcastEvent({ topic: 'gameshow', kind: 'buzz', buzzerId: buzzerId || 'debug', action: action || 'inject', slot, ts: Date.now() });
    res.status(202).json({ ok: true });
  });

  // Sound packs + clue media (media/apps/...). Raw /media/* is not served by
  // the app, so game assets flow through here with containment checks.
  router.get('/media/*splat', (req, res) => {
    if (!mediaAppsDir) return res.status(404).json({ error: 'media not configured' });
    const rel = splatPath(req);
    const filePath = path.resolve(mediaAppsDir, rel);
    if (!filePath.startsWith(path.resolve(mediaAppsDir) + path.sep)) {
      return res.status(404).json({ error: 'not found' });
    }
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
    });
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/4_api/v1/routers/gameshow.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire into routeMap and app.mjs**

In `backend/src/4_api/v1/routers/api.mjs`, add to `routeMap` (after `'/feedback': 'feedback',`):

```js
    '/gameshow': 'gameshow',
```

In `backend/src/app.mjs`:
1. With the other router imports (near line ~227): 

```js
import { createGameshowRouter } from './4_api/v1/routers/gameshow.mjs';
import { GameShowService } from './3_applications/gameshow/GameShowService.mjs';
import { GameShowSessionStore } from './3_applications/gameshow/GameShowSessionStore.mjs';
import { userService } from './0_system/config/UserService.mjs';
```

2. After the `v1Routers.feedback = createFeedbackRouter({ … });` block (~line 1427):

```js
  v1Routers.gameshow = createGameshowRouter({
    gameShowService: new GameShowService({
      configService,
      userService,
      logger: rootLogger.child({ module: 'gameshow' }),
    }),
    sessionStore: new GameShowSessionStore({
      sessionsDir: configService.getHouseholdPath('state/gameshow/sessions'),
      logger: rootLogger.child({ module: 'gameshow' }),
    }),
    broadcastEvent,
    mediaAppsDir: join(mediaBasePath, 'apps'),
    logger: rootLogger.child({ module: 'gameshow-api' }),
  });
```

Note: `broadcastEvent` is already imported at the top of app.mjs (~line 61) and `configService` / `rootLogger` / `mediaBasePath` are in scope in that region (grep `mediaBasePath` in app.mjs — it's the media volume root; `join` is node:path, already imported) — mirror exactly how the feedback block accesses them. `userService` may already be imported in app.mjs; check before adding a duplicate import. Verify `#api/utils/wildcard.mjs` `splatPath(req)` behavior against its use in `routers/static.mjs` before relying on it.

- [ ] **Step 6: Verify the app still boots and the route mounts**

Run: `npx vitest run backend/src/4_api/v1/routers/gameshow.test.mjs backend/src/4_api/v1/routers/emulator.test.mjs`
Expected: PASS (regression check on a neighbor router test).
Then boot check (dev server or a lighter smoke if the repo has one):

Run: `timeout 25 node backend/index.js 2>&1 | grep -iE "gameshow|listening|error" | head -20`
Expected: no gameshow-related errors; server reaches its listening line. (Ctrl-C/timeout kill is fine.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/gameshow.* backend/src/4_api/v1/routers/api.mjs backend/src/app.mjs
git commit -m "feat(gameshow): REST router (config/sets/sessions/buzz) wired into api v1"
```

### Task 5: Buzzer MQTT → WS relay (reuse MQTTSelectorAdapter)

**Files:**
- Modify: `backend/src/app.mjs` (the hardware-adapter block near line ~1585 where `selectors:` and `onSelectorSelect:` are configured)
- Test: `backend/src/3_applications/gameshow/buzzerSelectors.test.mjs`
- Create: `backend/src/3_applications/gameshow/buzzerSelectors.mjs`

**Interfaces:**
- Consumes: `gameshow.yml` `buzzers` list (`[{ id, mqtt_topic, buttons: { '<action>': 'slot_N' } }]`), existing `MQTTSelectorAdapter` selector config shape (`[{ id, mqtt_topic, equipment, buttons }]` — see `backend/src/1_adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs`), `broadcastEvent`.
- Produces: `buzzersToSelectors(buzzers) → selectors[]` (equipment: `'gameshow'`) and `makeBuzzerSelectHandler(broadcastEvent) → (selection) => void` which broadcasts `{ topic: 'gameshow', kind: 'buzz', buzzerId, action, slot, ts }`.

**Approach:** The existing adapter maps `action → buttons[action]` and calls `onSelect({ selectorId, equipmentId, userId, action })` — where `userId` is whatever value the buttons map holds (for us, a slot). We piggyback: convert gameshow buzzer configs into selector configs, append them to the fitness selectors list, and fan out in the existing `onSelectorSelect` callback based on `equipmentId === 'gameshow'`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/3_applications/gameshow/buzzerSelectors.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buzzersToSelectors, makeBuzzerSelectHandler } from './buzzerSelectors.mjs';

describe('buzzersToSelectors', () => {
  it('converts gameshow buzzer configs to MQTTSelectorAdapter selector configs', () => {
    const selectors = buzzersToSelectors([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
    expect(selectors).toEqual([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', equipment: 'gameshow', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
  });
  it('handles empty/missing input', () => {
    expect(buzzersToSelectors(null)).toEqual([]);
    expect(buzzersToSelectors([])).toEqual([]);
  });
});

describe('makeBuzzerSelectHandler', () => {
  it('broadcasts a gameshow buzz for gameshow selections', () => {
    const broadcastEvent = vi.fn();
    const handler = makeBuzzerSelectHandler(broadcastEvent);
    handler({ selectorId: 'lr', equipmentId: 'gameshow', userId: 'slot_1', action: '1_single' });
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gameshow', kind: 'buzz', buzzerId: 'lr', action: '1_single', slot: 'slot_1',
    }));
    expect(typeof broadcastEvent.mock.calls[0][0].ts).toBe('number');
  });
  it('ignores non-gameshow selections', () => {
    const broadcastEvent = vi.fn();
    makeBuzzerSelectHandler(broadcastEvent)({ selectorId: 'x', equipmentId: 'niceday', userId: 'felix', action: '1_single' });
    expect(broadcastEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/3_applications/gameshow/buzzerSelectors.test.mjs`
Expected: FAIL — cannot find module `./buzzerSelectors.mjs`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/3_applications/gameshow/buzzerSelectors.mjs
/**
 * Bridges gameshow.yml `buzzers` into the existing MQTTSelectorAdapter.
 *
 * A buzzer config is a selector whose buttons map zigbee actions to team
 * SLOTS (slot_1..slot_N) instead of user ids. We tag them with
 * equipment: 'gameshow' so the shared onSelect callback can route them.
 */
export function buzzersToSelectors(buzzers) {
  return (Array.isArray(buzzers) ? buzzers : []).map((b) => ({
    id: b.id,
    mqtt_topic: b.mqtt_topic,
    equipment: 'gameshow',
    buttons: b.buttons || {},
  }));
}

export function makeBuzzerSelectHandler(broadcastEvent) {
  return (selection) => {
    if (selection?.equipmentId !== 'gameshow') return;
    broadcastEvent({
      topic: 'gameshow',
      kind: 'buzz',
      buzzerId: selection.selectorId,
      action: selection.action,
      slot: selection.userId, // MQTTSelectorAdapter's generic "mapped value"
      ts: Date.now(),
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/3_applications/gameshow/buzzerSelectors.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into app.mjs**

In `backend/src/app.mjs`, find the hardware adapters block (~line 1585) with `selectors: (configService.getHouseholdAppConfig(householdId, 'fitness') || {}).selectors || []` and `onSelectorSelect: (selection) => { broadcastEvent({ topic: 'rider_select', ...selection }); }`. Change it to:

```js
    selectors: [
      ...((configService.getHouseholdAppConfig(householdId, 'fitness') || {}).selectors || []),
      ...buzzersToSelectors((configService.getHouseholdAppConfig(householdId, 'gameshow') || {}).buzzers),
    ],
    onSelectorSelect: (selection) => {
      if (selection?.equipmentId === 'gameshow') {
        handleGameshowBuzz(selection);
        return;
      }
      // selection: { selectorId, equipmentId, userId, action }
      broadcastEvent({ topic: 'rider_select', ...selection });
    },
```

Above that block (same scope), create the handler once:

```js
  const handleGameshowBuzz = makeBuzzerSelectHandler(broadcastEvent);
```

And add to app.mjs imports:

```js
import { buzzersToSelectors, makeBuzzerSelectHandler } from './3_applications/gameshow/buzzerSelectors.mjs';
```

- [ ] **Step 6: Boot check**

Run: `timeout 25 node backend/index.js 2>&1 | grep -iE "selector|gameshow|error" | head -20`
Expected: no new errors. With no `gameshow.yml` present yet, `buzzersToSelectors(undefined)` returns `[]` and the fitness selector behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/gameshow/buzzerSelectors.* backend/src/app.mjs
git commit -m "feat(gameshow): MQTT buzzer relay via existing selector adapter"
```

---

# Phase 2 — Shell frontend (game-agnostic services)

### Task 6: Module skeleton, widget registration, flow reducer

**Files:**
- Create: `frontend/src/modules/GameShow/shell/flow/flowReducer.js`
- Test: `frontend/src/modules/GameShow/shell/flow/flowReducer.test.js`
- Create: `frontend/src/modules/GameShow/GameShow.jsx` (minimal skeleton — fully assembled in Task 17)
- Create: `frontend/src/modules/GameShow/GameShow.scss` (empty file with a `.gameshow` root class)
- Create: `frontend/src/modules/GameShow/index.js`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`

**Interfaces:**
- Produces: `flowReducer(state, action)`, `initialFlowState`. Phases: `'loading' | 'resume-gate' | 'set-picker' | 'team-setup' | 'buzzer-bind' | 'playing' | 'results'`.
  - State: `{ phase, config: null|object, sets: [], game: 'jeopardy', setId: null|string, teams: [], sessionId: null|string, resumeSession: null|object, error: null|string }`
  - Actions: `BOOT_LOADED { config, sets, activeSession }`, `BOOT_FAILED { error }`, `RESUME_ACCEPT`, `RESUME_DISCARD`, `PICK_SET { setId }`, `TEAMS_CONFIRMED { teams }`, `BIND_DONE { bindings }` (press-to-bind results — `{ [slot]: teamId }` — stored as `state.buzzerBindings` and passed into the game so they survive the phase transition), `SESSION_CREATED { sessionId }`, `GAME_FINISHED`, `PLAY_AGAIN`.
  - Team object shape (used by Tasks 8–17): `{ id: 'team_1', name, color, slot: 'slot_1'|null, members: [{ id, name, avatar }] }`.
- Widget key: `'gameshow'` registered in builtins (component receives `{ dispatch, dismiss, clear }` like `weekly-review`).

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/shell/flow/flowReducer.test.js
import { describe, it, expect } from 'vitest';
import { flowReducer, initialFlowState } from './flowReducer.js';

const CONFIG = { defaults: { timer_seconds: 12, mute: false }, team_presets: [], buzzers: [], sounds: { pack: 'classic' } };
const SETS = [{ id: 's1', title: 'Set One', valid: true }];
const TEAMS = [{ id: 'team_1', name: 'Kids', color: '#e6b325', slot: null, members: [] }];

function boot(activeSession = null) {
  return flowReducer(initialFlowState, { type: 'BOOT_LOADED', config: CONFIG, sets: SETS, activeSession });
}

describe('flowReducer', () => {
  it('starts loading, lands on set-picker after boot with no active session', () => {
    expect(initialFlowState.phase).toBe('loading');
    const s = boot();
    expect(s.phase).toBe('set-picker');
    expect(s.sets).toHaveLength(1);
  });

  it('offers resume-gate when an active session exists; accept restores it', () => {
    const active = { id: 'gs_9', game: 'jeopardy', setId: 's1', teams: TEAMS, state: { inner: true } };
    let s = boot(active);
    expect(s.phase).toBe('resume-gate');
    s = flowReducer(s, { type: 'RESUME_ACCEPT' });
    expect(s.phase).toBe('playing');
    expect(s.sessionId).toBe('gs_9');
    expect(s.setId).toBe('s1');
    expect(s.teams).toEqual(TEAMS);
  });

  it('discarding resume falls through to set-picker', () => {
    const s = flowReducer(boot({ id: 'gs_9', game: 'jeopardy', setId: 's1', teams: [], state: null }), { type: 'RESUME_DISCARD' });
    expect(s.phase).toBe('set-picker');
    expect(s.sessionId).toBe(null);
  });

  it('walks the happy path: set → teams → bind → session → playing → results → again', () => {
    let s = boot();
    s = flowReducer(s, { type: 'PICK_SET', setId: 's1' });
    expect(s.phase).toBe('team-setup');
    s = flowReducer(s, { type: 'TEAMS_CONFIRMED', teams: TEAMS });
    expect(s.phase).toBe('buzzer-bind');
    expect(s.teams).toEqual(TEAMS);
    s = flowReducer(s, { type: 'BIND_DONE', bindings: { slot_3: 'team_1' } });
    expect(s.phase).toBe('playing');
    expect(s.buzzerBindings).toEqual({ slot_3: 'team_1' });
    s = flowReducer(s, { type: 'SESSION_CREATED', sessionId: 'gs_1' });
    expect(s.sessionId).toBe('gs_1');
    expect(s.phase).toBe('playing');
    s = flowReducer(s, { type: 'GAME_FINISHED' });
    expect(s.phase).toBe('results');
    s = flowReducer(s, { type: 'PLAY_AGAIN' });
    expect(s.phase).toBe('set-picker');
    expect(s.sessionId).toBe(null);
    expect(s.teams).toEqual(TEAMS); // teams are kept for the next game
  });

  it('BOOT_FAILED records the error', () => {
    const s = flowReducer(initialFlowState, { type: 'BOOT_FAILED', error: 'boom' });
    expect(s.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/flow/flowReducer.test.js`
Expected: FAIL — cannot find module `./flowReducer.js`

- [ ] **Step 3: Write the reducer**

```js
// frontend/src/modules/GameShow/shell/flow/flowReducer.js
// Outer shell flow: loading → (resume-gate) → set-picker → team-setup →
// buzzer-bind → playing → results. Game-agnostic — knows nothing about
// what happens inside 'playing' (the mounted game owns that).

export const initialFlowState = {
  phase: 'loading',
  config: null,
  sets: [],
  game: 'jeopardy',
  setId: null,
  teams: [],
  buzzerBindings: null,
  sessionId: null,
  resumeSession: null,
  error: null,
};

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      if (action.activeSession) return { ...next, phase: 'resume-gate', resumeSession: action.activeSession };
      return { ...next, phase: 'set-picker' };
    }
    case 'BOOT_FAILED':
      return { ...state, error: action.error };
    case 'RESUME_ACCEPT': {
      const s = state.resumeSession;
      if (!s) return state;
      return { ...state, phase: 'playing', sessionId: s.id, game: s.game, setId: s.setId, teams: s.teams || [], resumeSession: s };
    }
    case 'RESUME_DISCARD':
      return { ...state, phase: 'set-picker', resumeSession: null, sessionId: null };
    case 'PICK_SET':
      return { ...state, phase: 'team-setup', setId: action.setId };
    case 'TEAMS_CONFIRMED':
      return { ...state, phase: 'buzzer-bind', teams: action.teams };
    case 'BIND_DONE':
      return { ...state, phase: 'playing', buzzerBindings: action.bindings || null };
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };
    case 'GAME_FINISHED':
      return { ...state, phase: 'results' };
    case 'PLAY_AGAIN':
      return { ...state, phase: 'set-picker', setId: null, sessionId: null, resumeSession: null };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/flow/flowReducer.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Skeleton component + registration**

```jsx
// frontend/src/modules/GameShow/GameShow.jsx
// Shell root. Minimal skeleton for now — phases render placeholder text.
// Task 17 assembles the real per-phase screens.
import React, { useReducer, useEffect } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { flowReducer, initialFlowState } from './shell/flow/flowReducer.js';
import './GameShow.scss';

export default function GameShow({ dismiss }) {
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [config, setsRes, activeRes] = await Promise.all([
          DaylightAPI('api/v1/gameshow/config'),
          DaylightAPI('api/v1/gameshow/games/jeopardy/sets'),
          DaylightAPI('api/v1/gameshow/sessions/active'),
        ]);
        if (cancelled) return;
        dispatchFlow({ type: 'BOOT_LOADED', config, sets: setsRes.sets, activeSession: activeRes.session });
      } catch (err) {
        if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="gameshow" data-phase={flow.phase}>
      {flow.error ? <div className="gameshow__error">{flow.error}</div> : <div className="gameshow__phase">{flow.phase}</div>}
    </div>
  );
}
```

```scss
// frontend/src/modules/GameShow/GameShow.scss
.gameshow {
  width: 100%;
  height: 100%;
  background: #060ce9; // classic board blue backdrop
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

```js
// frontend/src/modules/GameShow/index.js
export { default as GameShow } from './GameShow.jsx';
```

In `frontend/src/screen-framework/widgets/builtins.js` add (mirroring the `weekly-review` lines):

```js
import GameShow from '../../modules/GameShow/GameShow.jsx';
// … inside registerBuiltinWidgets():
  registry.register('gameshow', GameShow);
```

- [ ] **Step 6: Verify the frontend builds**

Run: `npx vite build --logLevel error`
Expected: build completes with no errors mentioning GameShow. (If a full build is slow, `npx vitest run frontend/src/modules/GameShow` plus an eslint pass on the new files is an acceptable substitute.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/GameShow/ frontend/src/screen-framework/widgets/builtins.js
git commit -m "feat(gameshow): shell module skeleton, flow reducer, widget registration"
```

### Task 7: Session checkpoint client (hybrid persistence)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/session/sessionClient.js`
- Test: `frontend/src/modules/GameShow/shell/session/sessionClient.test.js`

**Interfaces:**
- Consumes: Task 4 endpoints via `DaylightAPI(path, data, method)` (`@/lib/api.mjs`; note: passing a data object auto-converts GET→POST).
- Produces:
  - `fetchBoot() → { config, sets, activeSession }` (parallel fetch used by GameShow.jsx — refactor Task 6's inline effect to use this)
  - `createSession({ game, setId, teams }) → session`
  - `finishSession(id) → session`
  - `makeCheckpointer({ debounceMs = 800, maxRetries = 3 }) → { push(sessionId, state), flush(), pendingCount() }` — debounced, serialized, retries with 1s/2s/4s backoff, never throws to the caller (logs + keeps latest snapshot; a newer push replaces a pending one).

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/shell/session/sessionClient.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '@/lib/api.mjs';
import { makeCheckpointer, createSession, finishSession, fetchBoot } from './sessionClient.js';

describe('sessionClient', () => {
  beforeEach(() => { vi.useFakeTimers(); DaylightAPI.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fetchBoot fetches config, sets, and active session in parallel', async () => {
    DaylightAPI
      .mockResolvedValueOnce({ defaults: {} })            // config
      .mockResolvedValueOnce({ sets: [{ id: 's1' }] })    // sets
      .mockResolvedValueOnce({ session: null });          // active
    const boot = await fetchBoot();
    expect(boot.sets).toEqual([{ id: 's1' }]);
    expect(boot.activeSession).toBe(null);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/config');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/games/jeopardy/sets');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/active');
  });

  it('createSession posts and returns the session', async () => {
    DaylightAPI.mockResolvedValueOnce({ id: 'gs_1' });
    const s = await createSession({ game: 'jeopardy', setId: 's1', teams: [] });
    expect(s.id).toBe('gs_1');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions', { game: 'jeopardy', setId: 's1', teams: [] }, 'POST');
  });

  it('debounces checkpoints — only the latest snapshot is sent', async () => {
    DaylightAPI.mockResolvedValue({ ok: true });
    const cp = makeCheckpointer({ debounceMs: 800 });
    cp.push('gs_1', { n: 1 });
    cp.push('gs_1', { n: 2 });
    cp.push('gs_1', { n: 3 });
    await vi.advanceTimersByTimeAsync(900);
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/gs_1/checkpoint', { state: { n: 3 } }, 'POST');
  });

  it('retries failed checkpoints with backoff and never throws', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce({ ok: true });
    const cp = makeCheckpointer({ debounceMs: 100 });
    cp.push('gs_1', { n: 1 });
    await vi.advanceTimersByTimeAsync(150);   // first attempt fails
    await vi.advanceTimersByTimeAsync(1100);  // 1s backoff retry succeeds
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
    expect(cp.pendingCount()).toBe(0);
  });

  it('finishSession posts finish', async () => {
    DaylightAPI.mockResolvedValueOnce({ status: 'complete' });
    await finishSession('gs_1');
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/gameshow/sessions/gs_1/finish', {}, 'POST');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/session/sessionClient.test.js`
Expected: FAIL — cannot find module `./sessionClient.js`

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/modules/GameShow/shell/session/sessionClient.js
// Hybrid persistence client: the frontend reducer is authoritative during
// play; this module checkpoints snapshots to the backend (debounced,
// retried) so a kiosk reload can resume. Gameplay NEVER blocks on it.
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

const log = () => getLogger().child({ component: 'gameshow-session' });

export async function fetchBoot() {
  const [config, setsRes, activeRes] = await Promise.all([
    DaylightAPI('api/v1/gameshow/config'),
    DaylightAPI('api/v1/gameshow/games/jeopardy/sets'),
    DaylightAPI('api/v1/gameshow/sessions/active'),
  ]);
  return { config, sets: setsRes.sets || [], activeSession: activeRes.session || null };
}

export function createSession({ game, setId, teams }) {
  return DaylightAPI('api/v1/gameshow/sessions', { game, setId, teams }, 'POST');
}

export function finishSession(id) {
  return DaylightAPI(`api/v1/gameshow/sessions/${id}/finish`, {}, 'POST');
}

export function makeCheckpointer({ debounceMs = 800, maxRetries = 3 } = {}) {
  let pending = null;        // { sessionId, state }
  let timer = null;
  let inFlight = false;

  async function send(attempt = 0) {
    if (!pending || inFlight) return;
    const { sessionId, state } = pending;
    pending = null;
    inFlight = true;
    try {
      await DaylightAPI(`api/v1/gameshow/sessions/${sessionId}/checkpoint`, { state }, 'POST');
    } catch (err) {
      log().warn('gameshow.checkpoint.failed', { attempt, error: err.message });
      if (attempt < maxRetries && !pending) {
        // restore the failed snapshot unless a newer one arrived meanwhile
        pending = { sessionId, state };
        timer = setTimeout(() => { timer = null; send(attempt + 1); }, 1000 * 2 ** attempt);
      }
    } finally {
      inFlight = false;
      if (pending && !timer) schedule();
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; send(0); }, debounceMs);
  }

  return {
    push(sessionId, state) {
      pending = { sessionId, state };
      schedule();
    },
    flush() { if (timer) { clearTimeout(timer); timer = null; } return send(0); },
    pendingCount() { return pending ? 1 : 0; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/session/sessionClient.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Refactor GameShow.jsx boot effect to use fetchBoot()**

Replace the inline `Promise.all` in `GameShow.jsx` (Task 6 Step 5) with:

```jsx
import { fetchBoot } from './shell/session/sessionClient.js';
// … in the effect:
      try {
        const { config, sets, activeSession } = await fetchBoot();
        if (cancelled) return;
        dispatchFlow({ type: 'BOOT_LOADED', config, sets, activeSession });
      } catch (err) {
        if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message });
      }
```

Run: `npx vitest run frontend/src/modules/GameShow`
Expected: PASS (all module tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/GameShow/shell/session/ frontend/src/modules/GameShow/GameShow.jsx
git commit -m "feat(gameshow): session client — boot fetch + debounced checkpoint with retry"
```

### Task 8: Buzzer service (arbitration + bind + WS + fallback keys)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.js` (pure logic)
- Create: `frontend/src/modules/GameShow/shell/buzzers/useBuzzers.js` (React binding)
- Test: `frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.test.js`

**Interfaces:**
- Consumes: WS events `{ topic: 'gameshow', kind: 'buzz', slot, buzzerId, action, ts }` via `useWebSocketSubscription('gameshow', cb, deps)` (`@/hooks/useWebSocket.js`); team shape from Task 6.
- Produces:
  - `class BuzzerArbiter` — constructor `(teams)` builds `slot → teamId` bindings from each team's `slot`. Methods: `arm(teamIds)`, `disarm()`, `handleBuzz(slot) → teamId|null` (locks on first armed hit; returns the newly locked teamId exactly once), `lockedTeamId`, `startBind(teamId)`, `handleBindPress(slot) → boolean` (binds slot→team, ends bind mode), `bindings()` → `{ [slot]: teamId }`, `snapshot()`/`restore(snap)` for checkpointing.
  - `useBuzzers({ teams, onLock })` hook — wires WS events into an arbiter instance, exposes `{ arbiter, locked, arm, disarm, startBind, bindingTeamId }`; also maps **fallback keyboard digits** (`'1'..'9'` keydown) to `slot_1..slot_9` so buzzer games are playable with no hardware (gamepad face buttons already synthesize Enter — digits come from a real keyboard or the debug `POST /buzz` endpoint).
- Task 15 (ClueScreen) consumes `arm/disarm/onLock`; Task 17's buzzer-bind phase consumes `startBind`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.test.js
import { describe, it, expect } from 'vitest';
import { BuzzerArbiter } from './BuzzerArbiter.js';

const TEAMS = [
  { id: 'team_1', name: 'Kids', slot: 'slot_1', members: [] },
  { id: 'team_2', name: 'Parents', slot: 'slot_2', members: [] },
];

describe('BuzzerArbiter', () => {
  it('first armed buzz locks its team; later buzzes are ignored', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.arm(['team_1', 'team_2']);
    expect(a.handleBuzz('slot_2')).toBe('team_2');
    expect(a.lockedTeamId).toBe('team_2');
    expect(a.handleBuzz('slot_1')).toBe(null); // already locked
  });

  it('buzzes are ignored when not armed, from unbound slots, and from un-armed teams', () => {
    const a = new BuzzerArbiter(TEAMS);
    expect(a.handleBuzz('slot_1')).toBe(null);       // not armed
    a.arm(['team_2']);
    expect(a.handleBuzz('slot_1')).toBe(null);       // team_1 not in armed set
    expect(a.handleBuzz('slot_9')).toBe(null);       // unbound slot
    expect(a.handleBuzz('slot_2')).toBe('team_2');
  });

  it('disarm clears lock; re-arm excludes a team (wrong-answer lockout)', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.arm(['team_1', 'team_2']);
    a.handleBuzz('slot_1');
    a.disarm();
    expect(a.lockedTeamId).toBe(null);
    a.arm(['team_2']); // team_1 answered wrong — re-arm the rest
    expect(a.handleBuzz('slot_1')).toBe(null);
    expect(a.handleBuzz('slot_2')).toBe('team_2');
  });

  it('bind mode: next press binds the slot to the team and ends bind mode', () => {
    const a = new BuzzerArbiter([{ id: 'team_1', name: 'Kids', slot: null, members: [] }]);
    a.startBind('team_1');
    expect(a.handleBindPress('slot_3')).toBe(true);
    expect(a.bindings()).toEqual({ slot_3: 'team_1' });
    expect(a.handleBindPress('slot_4')).toBe(false); // bind mode over
    a.arm(['team_1']);
    expect(a.handleBuzz('slot_3')).toBe('team_1');
  });

  it('re-binding a team removes its old slot; snapshot/restore round-trips', () => {
    const a = new BuzzerArbiter(TEAMS);
    a.startBind('team_1');
    a.handleBindPress('slot_5');
    expect(a.bindings()).toEqual({ slot_5: 'team_1', slot_2: 'team_2' });
    const b = new BuzzerArbiter(TEAMS);
    b.restore(a.snapshot());
    expect(b.bindings()).toEqual({ slot_5: 'team_1', slot_2: 'team_2' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.test.js`
Expected: FAIL — cannot find module `./BuzzerArbiter.js`

- [ ] **Step 3: Write the arbiter**

```js
// frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.js
// Pure first-buzz-wins arbitration + press-to-bind. No React, no I/O —
// fed by useBuzzers (WS events / fallback keys) and unit-tested directly.

export class BuzzerArbiter {
  constructor(teams = []) {
    this._slotToTeam = {};
    for (const t of teams) {
      if (t.slot) this._slotToTeam[t.slot] = t.id;
    }
    this._armed = new Set();
    this.lockedTeamId = null;
    this._bindingTeamId = null;
  }

  arm(teamIds = []) {
    this._armed = new Set(teamIds);
    this.lockedTeamId = null;
  }

  disarm() {
    this._armed = new Set();
    this.lockedTeamId = null;
  }

  handleBuzz(slot) {
    if (this.lockedTeamId || this._armed.size === 0) return null;
    const teamId = this._slotToTeam[slot];
    if (!teamId || !this._armed.has(teamId)) return null;
    this.lockedTeamId = teamId;
    return teamId;
  }

  startBind(teamId) { this._bindingTeamId = teamId; }
  get bindingTeamId() { return this._bindingTeamId; }

  handleBindPress(slot) {
    if (!this._bindingTeamId) return false;
    // one slot per team: drop the team's previous binding
    for (const [s, t] of Object.entries(this._slotToTeam)) {
      if (t === this._bindingTeamId) delete this._slotToTeam[s];
    }
    this._slotToTeam[slot] = this._bindingTeamId;
    this._bindingTeamId = null;
    return true;
  }

  bindings() { return { ...this._slotToTeam }; }
  snapshot() { return { slotToTeam: { ...this._slotToTeam } }; }
  restore(snap) { if (snap?.slotToTeam) this._slotToTeam = { ...snap.slotToTeam }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/buzzers/BuzzerArbiter.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the hook (thin, untested wiring — logic already covered)**

```js
// frontend/src/modules/GameShow/shell/buzzers/useBuzzers.js
import { useRef, useEffect, useState, useCallback } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';
import { BuzzerArbiter } from './BuzzerArbiter.js';

const log = () => getLogger().child({ component: 'gameshow-buzzers' });

/**
 * Wires buzz sources into a BuzzerArbiter:
 *  - WS `gameshow`/`buzz` events (MQTT relay or the debug POST /buzz endpoint)
 *  - fallback keyboard digits 1..9 → slot_1..slot_9 (playable with no hardware)
 * onLock(teamId) fires exactly once per armed window.
 */
export function useBuzzers({ teams, onLock }) {
  const arbiterRef = useRef(null);
  if (!arbiterRef.current) arbiterRef.current = new BuzzerArbiter(teams);
  const [locked, setLocked] = useState(null);
  const [bindingTeamId, setBindingTeamId] = useState(null);
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const handleSlot = useCallback((slot, source) => {
    const arbiter = arbiterRef.current;
    if (arbiter.bindingTeamId) {
      if (arbiter.handleBindPress(slot)) {
        log().info('gameshow.buzzer.bound', { slot, source });
        setBindingTeamId(null);
      }
      return;
    }
    const teamId = arbiter.handleBuzz(slot);
    if (teamId) {
      log().info('gameshow.buzz.locked', { slot, teamId, source });
      setLocked(teamId);
      onLockRef.current?.(teamId);
    }
  }, []);

  useWebSocketSubscription('gameshow', (msg) => {
    if (msg?.kind === 'buzz' && msg.slot) handleSlot(msg.slot, 'ws');
  }, [handleSlot]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^[1-9]$/.test(e.key)) handleSlot(`slot_${e.key}`, 'key');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSlot]);

  return {
    arbiter: arbiterRef.current,
    locked,
    bindingTeamId,
    arm: useCallback((teamIds) => { setLocked(null); arbiterRef.current.arm(teamIds); }, []),
    disarm: useCallback(() => { setLocked(null); arbiterRef.current.disarm(); }, []),
    startBind: useCallback((teamId) => { arbiterRef.current.startBind(teamId); setBindingTeamId(teamId); }, []),
  };
}
```

- [ ] **Step 6: Run all module tests**

Run: `npx vitest run frontend/src/modules/GameShow`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/GameShow/shell/buzzers/
git commit -m "feat(gameshow): buzzer arbitration, press-to-bind, WS + keyboard fallback"
```

### Task 9: Scoreboard (state + UI)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.js`
- Test: `frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.test.js`
- Create: `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.jsx`
- Create: `frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss`

**Interfaces:**
- Produces:
  - `initScores(teams) → { [teamId]: 0 }`
  - `scoreReducer(scores, action)` — actions: `AWARD { teamId, points }`, `DEDUCT { teamId, points }`, `SET_SCORE { teamId, points }` (host manual correction), `RESTORE { scores }`.
  - `<Scoreboard teams scores lockedTeamId activeTeamId />` — persistent bottom rail; locked team pulses, active (turn) team highlighted.
- Consumed by Task 13 (Jeopardy applies AWARD/DEDUCT via value×multiplier and wagers) and Task 17.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.test.js
import { describe, it, expect } from 'vitest';
import { scoreReducer, initScores } from './scoreReducer.js';

const TEAMS = [{ id: 'team_1' }, { id: 'team_2' }];

describe('scoreReducer', () => {
  it('initScores zeroes every team', () => {
    expect(initScores(TEAMS)).toEqual({ team_1: 0, team_2: 0 });
  });
  it('awards, deducts (can go negative), sets, restores', () => {
    let s = initScores(TEAMS);
    s = scoreReducer(s, { type: 'AWARD', teamId: 'team_1', points: 400 });
    expect(s.team_1).toBe(400);
    s = scoreReducer(s, { type: 'DEDUCT', teamId: 'team_1', points: 600 });
    expect(s.team_1).toBe(-200);
    s = scoreReducer(s, { type: 'SET_SCORE', teamId: 'team_2', points: 1000 });
    expect(s.team_2).toBe(1000);
    s = scoreReducer(s, { type: 'RESTORE', scores: { team_1: 5, team_2: 6 } });
    expect(s).toEqual({ team_1: 5, team_2: 6 });
  });
  it('ignores unknown teams and unknown actions', () => {
    let s = initScores(TEAMS);
    expect(scoreReducer(s, { type: 'AWARD', teamId: 'ghost', points: 100 })).toEqual(s);
    expect(scoreReducer(s, { type: 'NOPE' })).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write reducer + UI**

```js
// frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.js
export function initScores(teams = []) {
  return Object.fromEntries(teams.map((t) => [t.id, 0]));
}

export function scoreReducer(scores, action) {
  const has = (id) => Object.prototype.hasOwnProperty.call(scores, id);
  switch (action.type) {
    case 'AWARD':
      return has(action.teamId) ? { ...scores, [action.teamId]: scores[action.teamId] + action.points } : scores;
    case 'DEDUCT':
      return has(action.teamId) ? { ...scores, [action.teamId]: scores[action.teamId] - action.points } : scores;
    case 'SET_SCORE':
      return has(action.teamId) ? { ...scores, [action.teamId]: action.points } : scores;
    case 'RESTORE':
      return { ...action.scores };
    default:
      return scores;
  }
}
```

```jsx
// frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.jsx
import React from 'react';
import './Scoreboard.scss';

export function Scoreboard({ teams = [], scores = {}, lockedTeamId = null, activeTeamId = null }) {
  return (
    <div className="gs-scoreboard" data-testid="scoreboard">
      {teams.map((team) => (
        <div
          key={team.id}
          className={`gs-scoreboard__team${team.id === lockedTeamId ? ' is-locked' : ''}${team.id === activeTeamId ? ' is-active' : ''}`}
          style={{ '--team-color': team.color || '#888' }}
        >
          <span className="gs-scoreboard__name">{team.name}</span>
          <span className={`gs-scoreboard__score${(scores[team.id] ?? 0) < 0 ? ' is-negative' : ''}`}>
            {(scores[team.id] ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
export default Scoreboard;
```

```scss
// frontend/src/modules/GameShow/shell/scoreboard/Scoreboard.scss
.gs-scoreboard {
  display: flex;
  gap: 1rem;
  justify-content: center;
  padding: 0.75rem 1rem;

  &__team {
    min-width: 12rem;
    padding: 0.5rem 1.25rem;
    border-radius: 0.5rem;
    border-top: 0.35rem solid var(--team-color);
    background: rgba(0, 0, 0, 0.45);
    text-align: center;
    &.is-active { outline: 2px solid #fff; }
    &.is-locked { animation: gs-pulse 0.9s ease-in-out infinite; }
  }
  &__name { display: block; font-size: 1.1rem; opacity: 0.85; }
  &__score { display: block; font-size: 2rem; font-weight: 700; &.is-negative { color: #ff6b6b; } }
}
@keyframes gs-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--team-color); }
  50% { box-shadow: 0 0 1.2rem 0.2rem var(--team-color); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/scoreboard/scoreReducer.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/shell/scoreboard/
git commit -m "feat(gameshow): scoreboard state + team rail UI"
```

### Task 10: Audio cue engine + countdown timer

**Files:**
- Create: `frontend/src/modules/GameShow/shell/audio/AudioCueEngine.js`
- Test: `frontend/src/modules/GameShow/shell/audio/AudioCueEngine.test.js`
- Create: `frontend/src/modules/GameShow/shell/timers/useCountdown.js`
- Test: `frontend/src/modules/GameShow/shell/timers/useCountdown.test.js`
- Create: `frontend/src/modules/GameShow/shell/timers/TimerRing.jsx`

**Interfaces:**
- Produces:
  - `class AudioCueEngine({ pack, mute, audioFactory })` — `play(cue, { channel = 'sfx', loop = false })`, `stopChannel(channel)`, `duck(channel)` / `unduck(channel)` (volume 0.15 vs 1.0), `setMute(bool)`. Cue URL: `/api/v1/gameshow/media/gameshow/<pack>/<cue>.mp3` (Task 4's media route). Missing cue / playback error → logged no-op (never throws). `audioFactory` defaults to `(src) => new Audio(src)`; tests inject a fake.
  - Channels: `'music'` (think loops), `'sfx'` (stings), `'clue-media'` (exclusive: playing on it ducks `music` automatically; stopping unducks).
  - `useCountdown({ seconds, running, onExpire }) → { remaining, progress }` (ticks every 250ms; `progress` 1→0).
  - `<TimerRing progress />` — SVG ring, stroke-dashoffset driven.
- Consumed by Tasks 15–16 (clue reveal cue, think music, timeout stings, media clues).

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/modules/GameShow/shell/audio/AudioCueEngine.test.js
import { describe, it, expect, vi } from 'vitest';
import { AudioCueEngine } from './AudioCueEngine.js';

function makeFake() {
  const instances = [];
  const factory = (src) => {
    const a = {
      src, volume: 1, loop: false, paused: false,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(function () { this.paused = true; }),
    };
    instances.push(a);
    return a;
  };
  return { factory, instances };
}

describe('AudioCueEngine', () => {
  it('plays a cue from the pack path on the sfx channel', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('correct');
    expect(instances[0].src).toBe('/api/v1/gameshow/media/gameshow/classic/correct.mp3');
    expect(instances[0].play).toHaveBeenCalled();
  });

  it('mute suppresses playback; unmute restores', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', mute: true, audioFactory: factory });
    engine.play('correct');
    expect(instances).toHaveLength(0);
    engine.setMute(false);
    engine.play('correct');
    expect(instances).toHaveLength(1);
  });

  it('stopChannel pauses everything on that channel only', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('think', { channel: 'music', loop: true });
    engine.play('correct'); // sfx
    engine.stopChannel('music');
    expect(instances[0].pause).toHaveBeenCalled();
    expect(instances[1].pause).not.toHaveBeenCalled();
  });

  it('clue-media channel auto-ducks music and unducks when stopped', () => {
    const { factory, instances } = makeFake();
    const engine = new AudioCueEngine({ pack: 'classic', audioFactory: factory });
    engine.play('think', { channel: 'music', loop: true });
    engine.play('clip', { channel: 'clue-media' });
    expect(instances[0].volume).toBeCloseTo(0.15);
    engine.stopChannel('clue-media');
    expect(instances[0].volume).toBe(1);
  });

  it('playback errors never throw', () => {
    const engine = new AudioCueEngine({
      pack: 'classic',
      audioFactory: () => { throw new Error('no audio device'); },
    });
    expect(() => engine.play('correct')).not.toThrow();
  });
});
```

```js
// frontend/src/modules/GameShow/shell/timers/useCountdown.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from './useCountdown.js';

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down while running and fires onExpire once', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useCountdown({ seconds: 2, running: true, onExpire }));
    expect(result.current.remaining).toBe(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.remaining).toBeCloseTo(1, 0);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.remaining).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toBe(0);
  });

  it('does not tick when running=false and resets when seconds changes', () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ seconds, running }) => useCountdown({ seconds, running, onExpire }),
      { initialProps: { seconds: 5, running: false } });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.remaining).toBe(5);
    rerender({ seconds: 10, running: true });
    expect(result.current.remaining).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/GameShow/shell/audio frontend/src/modules/GameShow/shell/timers`
Expected: FAIL — modules not found. (If `renderHook` import fails because `@testing-library/react` is absent, check how existing hook tests in the repo render hooks — e.g. `frontend/src/screen-framework/*.test.jsx` — and mirror that harness instead.)

- [ ] **Step 3: Write the implementations**

```js
// frontend/src/modules/GameShow/shell/audio/AudioCueEngine.js
// Cue player with named channels. 'clue-media' is exclusive: while anything
// plays there, 'music' is ducked (name-that-tune must not fight think music).
import getLogger from '@/lib/logging/Logger.js';

const DUCKED = 0.15;

export class AudioCueEngine {
  constructor({ pack = 'classic', mute = false, audioFactory = (src) => new Audio(src) } = {}) {
    this.pack = pack;
    this.mute = mute;
    this.audioFactory = audioFactory;
    this.channels = { music: [], sfx: [], 'clue-media': [] };
    this.log = getLogger().child({ component: 'gameshow-audio' });
  }

  setMute(mute) {
    this.mute = mute;
    if (mute) Object.keys(this.channels).forEach((c) => this.stopChannel(c));
  }

  play(cue, { channel = 'sfx', loop = false } = {}) {
    if (this.mute) return;
    try {
      // served by the gameshow router's /media route (raw /media/* is not served)
      const audio = this.audioFactory(`/api/v1/gameshow/media/gameshow/${this.pack}/${cue}.mp3`);
      audio.loop = loop;
      (this.channels[channel] ||= []).push(audio);
      if (channel === 'clue-media') this.#setChannelVolume('music', DUCKED);
      const p = audio.play();
      p?.catch?.((err) => this.log.warn('gameshow.audio.play_failed', { cue, error: err.message }));
    } catch (err) {
      this.log.warn('gameshow.audio.error', { cue, error: err.message });
    }
  }

  stopChannel(channel) {
    for (const audio of this.channels[channel] || []) {
      try { audio.pause(); } catch { /* ignore */ }
    }
    this.channels[channel] = [];
    if (channel === 'clue-media') this.#setChannelVolume('music', 1);
  }

  duck(channel) { this.#setChannelVolume(channel, DUCKED); }
  unduck(channel) { this.#setChannelVolume(channel, 1); }

  #setChannelVolume(channel, volume) {
    for (const audio of this.channels[channel] || []) audio.volume = volume;
  }
}
```

```js
// frontend/src/modules/GameShow/shell/timers/useCountdown.js
import { useState, useEffect, useRef } from 'react';

const TICK_MS = 250;

export function useCountdown({ seconds, running, onExpire }) {
  const [remaining, setRemaining] = useState(seconds);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setRemaining(seconds);
    expiredRef.current = false;
  }, [seconds]);

  useEffect(() => {
    if (!running) return undefined;
    const startedAt = Date.now();
    const startFrom = remaining;
    const id = setInterval(() => {
      const left = Math.max(0, startFrom - (Date.now() - startedAt) / 1000);
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
        clearInterval(id);
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only on running/seconds change
  }, [running, seconds]);

  return { remaining, progress: seconds > 0 ? remaining / seconds : 0 };
}
```

```jsx
// frontend/src/modules/GameShow/shell/timers/TimerRing.jsx
import React from 'react';

const R = 44;
const CIRC = 2 * Math.PI * R;

export function TimerRing({ progress = 1, size = 96 }) {
  return (
    <svg className="gs-timer-ring" width={size} height={size} viewBox="0 0 100 100" data-testid="timer-ring">
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={R} fill="none"
        stroke={progress < 0.25 ? '#ff6b6b' : '#ffd54a'} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
        transform="rotate(-90 50 50)"
      />
    </svg>
  );
}
export default TimerRing;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/GameShow/shell/audio frontend/src/modules/GameShow/shell/timers`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/shell/audio/ frontend/src/modules/GameShow/shell/timers/
git commit -m "feat(gameshow): audio cue engine with channel ducking + countdown timer"
```

### Task 11: Team setup (presets + editing)

**Files:**
- Create: `frontend/src/modules/GameShow/shell/teams/teamSetupReducer.js`
- Test: `frontend/src/modules/GameShow/shell/teams/teamSetupReducer.test.js`
- Create: `frontend/src/modules/GameShow/shell/teams/TeamSetup.jsx`
- Create: `frontend/src/modules/GameShow/shell/teams/TeamSetup.scss`

**Interfaces:**
- Consumes: hydrated presets from Task 3's `getConfig()` (`team_presets[].teams[].members: [{ id, name, avatar }]`).
- Produces:
  - `teamSetupReducer(state, action)`, `initTeamSetup(config)` — state `{ teams, presetId }`; teams get ids `team_1..team_N` and slots `slot_1..slot_N` in order.
  - Actions: `LOAD_PRESET { preset }`, `ADD_TEAM`, `REMOVE_TEAM { teamId }`, `RENAME_TEAM { teamId, name }`, `ASSIGN_MEMBER { teamId, member }` (moves the member from any other team), `REMOVE_MEMBER { teamId, memberId }`, `ADD_GUEST { teamId }` (spec §6: guests need no profile — adds `{ id: 'guest_<n>', name: 'Guest <n>', avatar: null }` with `n` = first free index; remote-friendly auto-name instead of free-text typing).
  - `<TeamSetup config teams onChange onConfirm />` — preset row, team columns with member chips (`CircularUserAvatar` from `@/modules/Fitness/components/CircularUserAvatar.jsx` is reusable for avatars, as RiderPicker does), Confirm button. Remote-nav friendly (all controls are `<button>`s reachable with arrows — rely on natural DOM focus order + the GamepadAdapter's synthetic arrow keys).
- Confirm calls `onConfirm(teams)` → shell dispatches `TEAMS_CONFIRMED`.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/shell/teams/teamSetupReducer.test.js
import { describe, it, expect } from 'vitest';
import { teamSetupReducer, initTeamSetup } from './teamSetupReducer.js';

const PRESET = {
  id: 'kids_vs_parents',
  name: 'Kids vs Parents',
  teams: [
    { name: 'Kids', color: '#e6b325', members: [{ id: 'felix', name: 'Felix', avatar: null }] },
    { name: 'Parents', color: '#3273dc', members: [{ id: 'kckern', name: 'KC', avatar: null }] },
  ],
};

describe('teamSetupReducer', () => {
  it('init with no presets yields two empty default teams with slots', () => {
    const s = initTeamSetup({ team_presets: [] });
    expect(s.teams).toHaveLength(2);
    expect(s.teams[0]).toMatchObject({ id: 'team_1', slot: 'slot_1' });
    expect(s.teams[1]).toMatchObject({ id: 'team_2', slot: 'slot_2' });
  });

  it('init with presets loads the first preset', () => {
    const s = initTeamSetup({ team_presets: [PRESET] });
    expect(s.presetId).toBe('kids_vs_parents');
    expect(s.teams[0].name).toBe('Kids');
    expect(s.teams[0].members[0].id).toBe('felix');
  });

  it('LOAD_PRESET replaces teams; ADD/REMOVE/RENAME work and re-slot', () => {
    let s = initTeamSetup({ team_presets: [] });
    s = teamSetupReducer(s, { type: 'LOAD_PRESET', preset: PRESET });
    expect(s.teams).toHaveLength(2);
    s = teamSetupReducer(s, { type: 'ADD_TEAM' });
    expect(s.teams).toHaveLength(3);
    expect(s.teams[2].slot).toBe('slot_3');
    s = teamSetupReducer(s, { type: 'REMOVE_TEAM', teamId: s.teams[0].id });
    expect(s.teams).toHaveLength(2);
    expect(s.teams.map((t) => t.slot)).toEqual(['slot_1', 'slot_2']); // re-slotted
    s = teamSetupReducer(s, { type: 'RENAME_TEAM', teamId: s.teams[0].id, name: 'Champs' });
    expect(s.teams[0].name).toBe('Champs');
  });

  it('ASSIGN_MEMBER moves a member between teams (no duplicates)', () => {
    let s = initTeamSetup({ team_presets: [PRESET] });
    const felix = { id: 'felix', name: 'Felix', avatar: null };
    s = teamSetupReducer(s, { type: 'ASSIGN_MEMBER', teamId: 'team_2', member: felix });
    expect(s.teams[0].members.find((m) => m.id === 'felix')).toBeUndefined();
    expect(s.teams[1].members.some((m) => m.id === 'felix')).toBe(true);
    s = teamSetupReducer(s, { type: 'REMOVE_MEMBER', teamId: 'team_2', memberId: 'felix' });
    expect(s.teams[1].members.some((m) => m.id === 'felix')).toBe(false);
  });

  it('ADD_GUEST adds profile-less members with unique ids', () => {
    let s = initTeamSetup({ team_presets: [] });
    s = teamSetupReducer(s, { type: 'ADD_GUEST', teamId: 'team_1' });
    s = teamSetupReducer(s, { type: 'ADD_GUEST', teamId: 'team_2' });
    expect(s.teams[0].members[0]).toEqual({ id: 'guest_1', name: 'Guest 1', avatar: null });
    expect(s.teams[1].members[0]).toEqual({ id: 'guest_2', name: 'Guest 2', avatar: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/teams/teamSetupReducer.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the reducer**

```js
// frontend/src/modules/GameShow/shell/teams/teamSetupReducer.js
// Editable team roster. Teams always carry sequential ids/slots
// (team_1/slot_1 …) so buzzer configs can address them stably.

const COLORS = ['#e6b325', '#3273dc', '#2fbf71', '#e05263', '#9b5de5', '#f28c28'];

function reslot(teams) {
  return teams.map((t, i) => ({ ...t, id: `team_${i + 1}`, slot: `slot_${i + 1}` }));
}

function fromPreset(preset) {
  return reslot((preset.teams || []).map((t, i) => ({
    name: t.name || `Team ${i + 1}`,
    color: t.color || COLORS[i % COLORS.length],
    members: [...(t.members || [])],
  })));
}

function defaultTeams() {
  return reslot([
    { name: 'Team 1', color: COLORS[0], members: [] },
    { name: 'Team 2', color: COLORS[1], members: [] },
  ]);
}

export function initTeamSetup(config = {}) {
  const preset = (config.team_presets || [])[0] || null;
  return {
    presetId: preset?.id || null,
    teams: preset ? fromPreset(preset) : defaultTeams(),
  };
}

export function teamSetupReducer(state, action) {
  switch (action.type) {
    case 'LOAD_PRESET':
      return { presetId: action.preset.id, teams: fromPreset(action.preset) };
    case 'ADD_TEAM': {
      const n = state.teams.length;
      return { ...state, teams: reslot([...state.teams, { name: `Team ${n + 1}`, color: COLORS[n % COLORS.length], members: [] }]) };
    }
    case 'REMOVE_TEAM':
      return { ...state, teams: reslot(state.teams.filter((t) => t.id !== action.teamId)) };
    case 'RENAME_TEAM':
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, name: action.name } : t)) };
    case 'ASSIGN_MEMBER': {
      const stripped = state.teams.map((t) => ({ ...t, members: t.members.filter((m) => m.id !== action.member.id) }));
      return { ...state, teams: stripped.map((t) => (t.id === action.teamId ? { ...t, members: [...t.members, action.member] } : t)) };
    }
    case 'REMOVE_MEMBER':
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, members: t.members.filter((m) => m.id !== action.memberId) } : t)) };
    case 'ADD_GUEST': {
      const taken = new Set(state.teams.flatMap((t) => t.members.map((m) => m.id)));
      let n = 1;
      while (taken.has(`guest_${n}`)) n += 1;
      const guest = { id: `guest_${n}`, name: `Guest ${n}`, avatar: null };
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, members: [...t.members, guest] } : t)) };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/teams/teamSetupReducer.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the UI**

```jsx
// frontend/src/modules/GameShow/shell/teams/TeamSetup.jsx
// TV-friendly team editor: preset row on top, team columns, all-users pool
// at the bottom. Every control is a <button> so arrow-key / gamepad focus
// traversal works without a custom focus engine.
import React, { useReducer, useMemo } from 'react';
import { teamSetupReducer, initTeamSetup } from './teamSetupReducer.js';
import './TeamSetup.scss';

export function TeamSetup({ config, onConfirm }) {
  const [state, dispatch] = useReducer(teamSetupReducer, config, initTeamSetup);
  const presets = config?.team_presets || [];

  // Pool = every member known from presets, minus those already on a team.
  const pool = useMemo(() => {
    const assigned = new Set(state.teams.flatMap((t) => t.members.map((m) => m.id)));
    const all = new Map();
    for (const p of presets) {
      for (const t of p.teams) for (const m of t.members) all.set(m.id, m);
    }
    return [...all.values()].filter((m) => !assigned.has(m.id));
  }, [presets, state.teams]);

  return (
    <div className="gs-teamsetup" data-testid="team-setup">
      {presets.length > 0 && (
        <div className="gs-teamsetup__presets">
          {presets.map((p) => (
            <button key={p.id} type="button"
              className={`gs-chip${state.presetId === p.id ? ' is-active' : ''}`}
              onClick={() => dispatch({ type: 'LOAD_PRESET', preset: p })}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="gs-teamsetup__teams">
        {state.teams.map((team) => (
          <div key={team.id} className="gs-teamsetup__team" style={{ '--team-color': team.color }}>
            <div className="gs-teamsetup__teamname">{team.name}</div>
            {team.members.map((m) => (
              <button key={m.id} type="button" className="gs-chip gs-chip--member"
                onClick={() => dispatch({ type: 'REMOVE_MEMBER', teamId: team.id, memberId: m.id })}>
                {m.name} ×
              </button>
            ))}
            {pool.map((m) => (
              <button key={`add-${m.id}`} type="button" className="gs-chip gs-chip--pool"
                onClick={() => dispatch({ type: 'ASSIGN_MEMBER', teamId: team.id, member: m })}>
                + {m.name}
              </button>
            ))}
            <button type="button" className="gs-chip gs-chip--pool"
              onClick={() => dispatch({ type: 'ADD_GUEST', teamId: team.id })}>
              + Guest
            </button>
            {state.teams.length > 2 && (
              <button type="button" className="gs-chip gs-chip--danger"
                onClick={() => dispatch({ type: 'REMOVE_TEAM', teamId: team.id })}>
                Remove team
              </button>
            )}
          </div>
        ))}
        <button type="button" className="gs-teamsetup__add" onClick={() => dispatch({ type: 'ADD_TEAM' })}>+ Team</button>
      </div>

      <button type="button" className="gs-teamsetup__confirm" data-testid="teams-confirm"
        onClick={() => onConfirm?.(state.teams)}>
        Start with {state.teams.length} teams
      </button>
    </div>
  );
}
export default TeamSetup;
```

```scss
// frontend/src/modules/GameShow/shell/teams/TeamSetup.scss
.gs-teamsetup {
  display: flex; flex-direction: column; gap: 1.5rem; padding: 2rem; height: 100%;
  &__presets { display: flex; gap: 0.75rem; justify-content: center; }
  &__teams { display: flex; gap: 1.25rem; justify-content: center; flex: 1; }
  &__team {
    min-width: 16rem; padding: 1rem; border-radius: 0.75rem;
    border-top: 0.4rem solid var(--team-color); background: rgba(0, 0, 0, 0.4);
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  &__teamname { font-size: 1.4rem; font-weight: 700; }
  &__add, &__confirm {
    font-size: 1.2rem; padding: 0.75rem 1.5rem; border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.12); color: #fff; border: none; cursor: pointer;
    &:focus { outline: 3px solid #ffd54a; }
  }
  &__confirm { align-self: center; background: #ffd54a; color: #111; font-weight: 700; }
}
.gs-chip {
  padding: 0.4rem 0.9rem; border-radius: 999px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 1rem;
  &:focus { outline: 3px solid #ffd54a; }
  &.is-active { background: #ffd54a; color: #111; }
  &--pool { opacity: 0.65; }
  &--danger { background: rgba(224, 82, 99, 0.4); }
}
```

- [ ] **Step 6: Run module tests + commit**

Run: `npx vitest run frontend/src/modules/GameShow`
Expected: PASS

```bash
git add frontend/src/modules/GameShow/shell/teams/
git commit -m "feat(gameshow): team setup — presets, editing, slot assignment"
```

### Task 12: Shared display components

**Files:**
- Create: `frontend/src/modules/GameShow/shell/components/TitleCard.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/RevealPanel.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/MediaCluePlayer.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/WagerPanel.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/ControlLegend.jsx`
- Create: `frontend/src/modules/GameShow/shell/components/components.scss`
- Test: `frontend/src/modules/GameShow/shell/components/WagerPanel.test.js` (wager clamp logic — extracted pure)

**Interfaces (consumed by Tasks 15–17):**
- `<TitleCard title subtitle />` — full-screen interstitial (round intros, game title).
- `<RevealPanel prompt revealed answer />` — prompt text large; answer strip appears when `revealed`.
- `<MediaCluePlayer media onError />` — renders `media.type` image/audio/video from `/media/apps/<media.src>`; calls `onError(message)` on load failure (Task 15 falls back to text). Audio/video use native `<audio>/<video>` with `autoPlay`; the CALLER handles ducking via AudioCueEngine.
- `clampWager(amount, { score, roundMax }) → number` — min 5, max `Math.max(score, roundMax)` (classic Daily Double rule), integers only. Exported from `WagerPanel.jsx`.
- `<WagerPanel teamName score roundMax value onChange onConfirm />` — +/-100 stepper buttons and confirm; displays clamped value. (Screen shows only "wager locked" for Final — the HOST operates this panel; spec §3.3.)
- `<ControlLegend items />` — bottom hint strip, `items: [{ key: '↵', label: 'Reveal' }, …]` (mirrors WeeklyReview's ControlLegend idea).

- [ ] **Step 1: Write the failing test (wager clamp)**

```js
// frontend/src/modules/GameShow/shell/components/WagerPanel.test.js
import { describe, it, expect } from 'vitest';
import { clampWager } from './WagerPanel.jsx';

describe('clampWager', () => {
  it('clamps to [5, max(score, roundMax)] and floors to integer', () => {
    expect(clampWager(0, { score: 1000, roundMax: 500 })).toBe(5);
    expect(clampWager(-50, { score: 1000, roundMax: 500 })).toBe(5);
    expect(clampWager(700.9, { score: 1000, roundMax: 500 })).toBe(700);
    expect(clampWager(5000, { score: 1000, roundMax: 500 })).toBe(1000);
    expect(clampWager(5000, { score: 200, roundMax: 500 })).toBe(500); // roundMax rescue for low scores
    expect(clampWager(NaN, { score: 200, roundMax: 500 })).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/shell/components/WagerPanel.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the components**

```jsx
// frontend/src/modules/GameShow/shell/components/TitleCard.jsx
import React from 'react';
import './components.scss';

export function TitleCard({ title, subtitle = null }) {
  return (
    <div className="gs-titlecard" data-testid="title-card">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}
export default TitleCard;
```

```jsx
// frontend/src/modules/GameShow/shell/components/RevealPanel.jsx
import React from 'react';
import './components.scss';

export function RevealPanel({ prompt, revealed = false, answer = null }) {
  return (
    <div className="gs-reveal" data-testid="reveal-panel">
      <div className="gs-reveal__prompt">{prompt}</div>
      {revealed && answer && <div className="gs-reveal__answer">{answer}</div>}
    </div>
  );
}
export default RevealPanel;
```

```jsx
// frontend/src/modules/GameShow/shell/components/MediaCluePlayer.jsx
import React from 'react';
import './components.scss';

/**
 * Renders a media attachment (image/audio/video) from the media volume.
 * src in game sets is relative to media/apps/ (spec §5); served through the
 * gameshow router's /media route (raw /media/* is not served by the app).
 */
export function MediaCluePlayer({ media, onError }) {
  if (!media?.type || !media?.src) return null;
  const url = `/api/v1/gameshow/media/${media.src}`;
  const fail = () => onError?.(`media unavailable: ${media.src}`);
  if (media.type === 'image') return <img className="gs-media gs-media--image" src={url} alt="" onError={fail} />;
  if (media.type === 'audio') return <audio className="gs-media" src={url} autoPlay onError={fail} data-testid="media-audio" />;
  if (media.type === 'video') return <video className="gs-media gs-media--video" src={url} autoPlay onError={fail} data-testid="media-video" />;
  return null;
}
export default MediaCluePlayer;
```

```jsx
// frontend/src/modules/GameShow/shell/components/WagerPanel.jsx
import React from 'react';
import './components.scss';

export function clampWager(amount, { score, roundMax }) {
  const max = Math.max(score, roundMax);
  const n = Number.isFinite(amount) ? Math.floor(amount) : 5;
  return Math.min(Math.max(n, 5), max);
}

const STEP = 100;

export function WagerPanel({ teamName, score, roundMax, value, onChange, onConfirm }) {
  const bounds = { score, roundMax };
  return (
    <div className="gs-wager" data-testid="wager-panel">
      <div className="gs-wager__team">{teamName} — wager</div>
      <div className="gs-wager__row">
        <button type="button" onClick={() => onChange(clampWager(value - STEP, bounds))}>−{STEP}</button>
        <div className="gs-wager__amount">{clampWager(value, bounds).toLocaleString()}</div>
        <button type="button" onClick={() => onChange(clampWager(value + STEP, bounds))}>+{STEP}</button>
      </div>
      <button type="button" className="gs-wager__confirm" onClick={() => onConfirm(clampWager(value, bounds))}>
        Lock wager
      </button>
    </div>
  );
}
export default WagerPanel;
```

```jsx
// frontend/src/modules/GameShow/shell/components/ControlLegend.jsx
import React from 'react';
import './components.scss';

export function ControlLegend({ items = [] }) {
  return (
    <div className="gs-legend" data-testid="control-legend">
      {items.map((item) => (
        <span key={item.label} className="gs-legend__item">
          <kbd>{item.key}</kbd> {item.label}
        </span>
      ))}
    </div>
  );
}
export default ControlLegend;
```

```scss
// frontend/src/modules/GameShow/shell/components/components.scss
.gs-titlecard {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  h1 { font-size: 5rem; text-transform: uppercase; letter-spacing: 0.08em; text-shadow: 0.15rem 0.15rem 0 #000; }
  p { font-size: 1.6rem; opacity: 0.8; }
}
.gs-reveal {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2rem; height: 100%; padding: 3rem; text-align: center;
  &__prompt { font-size: 3.2rem; font-weight: 600; text-shadow: 0.12rem 0.12rem 0 #000; }
  &__answer { font-size: 2.2rem; color: #ffd54a; border-top: 2px solid rgba(255,255,255,0.3); padding-top: 1.5rem; }
}
.gs-media {
  &--image { max-width: 70%; max-height: 50vh; border-radius: 0.5rem; }
  &--video { max-width: 70%; max-height: 50vh; }
}
.gs-wager {
  display: flex; flex-direction: column; gap: 1.25rem; align-items: center; justify-content: center; height: 100%;
  &__team { font-size: 2rem; font-weight: 700; }
  &__row { display: flex; gap: 1.5rem; align-items: center;
    button { font-size: 1.5rem; padding: 0.5rem 1.25rem; border-radius: 0.5rem; border: none; cursor: pointer;
      background: rgba(255,255,255,0.15); color: #fff; &:focus { outline: 3px solid #ffd54a; } } }
  &__amount { font-size: 3rem; font-weight: 800; min-width: 10rem; text-align: center; }
  &__confirm { font-size: 1.3rem; padding: 0.75rem 2rem; border-radius: 0.5rem; border: none; cursor: pointer;
    background: #ffd54a; color: #111; font-weight: 700; &:focus { outline: 3px solid #fff; } }
}
.gs-legend {
  display: flex; gap: 1.5rem; justify-content: center; padding: 0.5rem; font-size: 1rem; opacity: 0.7;
  kbd { background: rgba(255,255,255,0.15); border-radius: 0.25rem; padding: 0.1rem 0.5rem; margin-right: 0.3rem; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/shell/components/WagerPanel.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/shell/components/
git commit -m "feat(gameshow): shared display components (title, reveal, media, wager, legend)"
```

---

# Phase 3 — Jeopardy game

### Task 13: Jeopardy round state machine (pure reducer)

**Files:**
- Create: `frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.js`
- Test: `frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.test.js`

**Interfaces:**
- Consumes: normalized game set (Task 1 shape) and `teamIds: string[]` (from Task 6 teams).
- Produces:
  - `initJeopardy(set, teamIds) → state` — state: `{ set, teamIds, roundIndex, phase, cursor: { cat, row }, used: {}, active: null|{ cat, row, clue }, isDailyDouble, wager, answeringTeamId, attempted: [], turnTeamId, revealed, finalWagers: {}, finalJudged: {} }`.
  - Phases: `'round-intro' | 'board' | 'wager' | 'clue' | 'judging' | 'final-category' | 'final-wager' | 'final-clue' | 'final-judging' | 'done'`.
  - Actions: `START_ROUND`, `MOVE_CURSOR { dir }`, `SELECT_TILE`, `BUZZ { teamId }`, `REVEAL`, `JUDGE { correct }`, `TIMEOUT`, `RETURN_TO_BOARD`, `SET_WAGER { amount }`, `SET_FINAL_WAGER { teamId, amount }`, `JUDGE_FINAL { teamId, correct }`, `RESTORE { snapshot }`.
  - Helpers: `currentRound(state)`, `clueAt(state, cat, row)`, `isUsed(state, cat, row)`, `scoreDelta(state, correct) → { teamId, delta }|null` (value×multiplier, or wager for daily double / turns attribution; `delta` negative only when `correct === false` AND round `penalize_wrong`), `boardDone(state)`, `snapshot(state)` (JSON-safe — everything except `set`).
- Mode semantics (per spec §7): **hosted** = buzz→judge, wrong re-arms remaining teams; **self** = buzz→auto-reveal→confirm; **turns** = active team answers, rotation advances after each clue.
- Task 15/16 components dispatch these actions; Task 14 keymap emits them.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.test.js
import { describe, it, expect } from 'vitest';
import { initJeopardy, jeopardyReducer, scoreDelta, boardDone, snapshot } from './jeopardyReducer.js';

const TEAM_IDS = ['team_1', 'team_2'];

function makeSet({ mode = 'hosted', withFinal = true, penalize = true } = {}) {
  return {
    id: 's', title: 'S', description: '',
    rounds: [{
      name: 'R1', mode, multiplier: 1, timer_seconds: null, penalize_wrong: penalize,
      categories: [
        { name: 'CatA', clues: [
          { value: 100, clue: 'a1', answer: 'A1', media: null, daily_double: false },
          { value: 200, clue: 'a2', answer: 'A2', media: null, daily_double: true },
        ] },
        { name: 'CatB', clues: [
          { value: 100, clue: 'b1', answer: 'B1', media: null, daily_double: false },
        ] },
      ],
    }],
    final: withFinal ? { category: 'Fin', clue: 'f', answer: 'F', media: null } : null,
  };
}

function toBoard(set = makeSet()) {
  let s = initJeopardy(set, TEAM_IDS);
  expect(s.phase).toBe('round-intro');
  s = jeopardyReducer(s, { type: 'START_ROUND' });
  expect(s.phase).toBe('board');
  return s;
}

describe('jeopardyReducer — hosted mode', () => {
  it('select → buzz → correct: scores, marks used, winner picks next', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' }); // cursor at 0,0
    expect(s.phase).toBe('clue');
    expect(s.active.clue.clue).toBe('a1');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_2', delta: 100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
    expect(s.turnTeamId).toBe('team_2');
  });

  it('wrong answer re-opens the clue for remaining teams; all-wrong reveals', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: -100 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('clue');
    expect(s.attempted).toEqual(['team_1']);
    expect(s.answeringTeamId).toBe(null);
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' }); // repeat buzz ignored
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.revealed).toBe(true); // everyone missed → answer shows
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.phase).toBe('board');
    expect(s.used['0:0:0']).toBe(true);
  });

  it('no penalty when penalize_wrong is false', () => {
    let s = toBoard(makeSet({ penalize: false }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_1' });
    expect(scoreDelta(s, false)).toEqual({ teamId: 'team_1', delta: 0 });
  });

  it('timeout reveals; return marks used', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'TIMEOUT' });
    expect(s.revealed).toBe(true);
    s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
    expect(s.used['0:0:0']).toBe(true);
  });
});

describe('daily double', () => {
  it('selecting a daily-double goes to wager; delta uses the wager', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'MOVE_CURSOR', dir: 'down' }); // row 1 (a2, DD)
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.phase).toBe('wager');
    expect(s.isDailyDouble).toBe(true);
    expect(s.answeringTeamId).toBe('team_1'); // turn team answers a DD
    s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 500 });
    expect(s.phase).toBe('clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(scoreDelta(s, true)).toEqual({ teamId: 'team_1', delta: 500 });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: false });
    expect(s.phase).toBe('board'); // DD: only one team answers, straight back
    expect(s.used['0:0:1']).toBe(true);
  });
});

describe('turns mode', () => {
  it('active team answers, rotation advances after every clue', () => {
    let s = toBoard(makeSet({ mode: 'turns' }));
    expect(s.turnTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    expect(s.answeringTeamId).toBe('team_1');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
    expect(s.turnTeamId).toBe('team_2'); // rotated regardless of outcome
  });
});

describe('self mode', () => {
  it('buzz → auto-reveal → single judge', () => {
    let s = toBoard(makeSet({ mode: 'self' }));
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    s = jeopardyReducer(s, { type: 'BUZZ', teamId: 'team_2' });
    expect(s.phase).toBe('judging');
    expect(s.revealed).toBe(true); // self mode reveals on buzz
    s = jeopardyReducer(s, { type: 'JUDGE', correct: true });
    expect(s.phase).toBe('board');
  });
});

describe('round + final progression', () => {
  function clearBoard(s) {
    // exhaust all three clues via timeout
    const picks = [['SELECT_TILE'], ['MOVE_CURSOR', 'down'], ['SELECT_TILE'], ['MOVE_CURSOR', 'right'], ['SELECT_TILE']];
    for (const [type, dir] of picks) {
      s = jeopardyReducer(s, { type, dir });
      if (s.phase === 'wager') s = jeopardyReducer(s, { type: 'SET_WAGER', amount: 5 });
      if (s.phase === 'clue') {
        s = jeopardyReducer(s, { type: 'TIMEOUT' });
        s = jeopardyReducer(s, { type: 'RETURN_TO_BOARD' });
      }
    }
    return s;
  }

  it('clearing the last round moves to final; wagers → clue → judging → done', () => {
    let s = clearBoard(toBoard());
    expect(boardDone(s)).toBe(true);
    expect(s.phase).toBe('final-category');
    s = jeopardyReducer(s, { type: 'START_ROUND' }); // advance from final category card
    expect(s.phase).toBe('final-wager');
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_1', amount: 100 });
    expect(s.phase).toBe('final-wager'); // still waiting on team_2
    s = jeopardyReducer(s, { type: 'SET_FINAL_WAGER', teamId: 'team_2', amount: 200 });
    expect(s.phase).toBe('final-clue');
    s = jeopardyReducer(s, { type: 'REVEAL' });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_1', correct: true });
    expect(s.phase).toBe('final-judging');
    s = jeopardyReducer(s, { type: 'JUDGE_FINAL', teamId: 'team_2', correct: false });
    expect(s.phase).toBe('done');
    expect(s.finalWagers).toEqual({ team_1: 100, team_2: 200 });
  });

  it('a set with no final goes straight to done', () => {
    const s = clearBoard(toBoard(makeSet({ withFinal: false })));
    expect(s.phase).toBe('done');
  });

  it('snapshot/RESTORE round-trips without the set', () => {
    let s = toBoard();
    s = jeopardyReducer(s, { type: 'SELECT_TILE' });
    const snap = snapshot(s);
    expect(snap.set).toBeUndefined();
    let restored = initJeopardy(makeSet(), TEAM_IDS);
    restored = jeopardyReducer(restored, { type: 'RESTORE', snapshot: snap });
    expect(restored.phase).toBe('clue');
    expect(restored.active.clue.clue).toBe('a1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the reducer**

```js
// frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.js
// Pure Jeopardy state machine. Scores live in the shell's scoreReducer —
// components call scoreDelta(state, correct) BEFORE dispatching JUDGE and
// apply the delta to the scoreboard. All three per-round modes (spec §7):
//   hosted: buzz → host judges; wrong re-arms remaining teams
//   self:   buzz → answer auto-reveals → single confirm
//   turns:  active team answers; rotation advances every clue

export function currentRound(state) { return state.set.rounds[state.roundIndex]; }
export function clueAt(state, cat, row) { return currentRound(state)?.categories[cat]?.clues[row] || null; }
export function isUsed(state, cat, row) { return !!state.used[`${state.roundIndex}:${cat}:${row}`]; }

export function boardDone(state) {
  const round = currentRound(state);
  if (!round) return true;
  return round.categories.every((c, cat) => c.clues.every((_, row) => isUsed(state, cat, row)));
}

export function scoreDelta(state, correct) {
  const teamId = state.answeringTeamId;
  if (!teamId || !state.active) return null;
  const base = state.isDailyDouble ? state.wager : state.active.clue.value * currentRound(state).multiplier;
  if (correct) return { teamId, delta: base };
  return { teamId, delta: currentRound(state).penalize_wrong ? -base : 0 };
}

export function snapshot(state) {
  const { set, ...rest } = state;
  return { ...rest };
}

export function initJeopardy(set, teamIds) {
  return {
    set,
    teamIds,
    roundIndex: 0,
    phase: 'round-intro',
    cursor: { cat: 0, row: 0 },
    used: {},
    active: null,
    isDailyDouble: false,
    wager: null,
    answeringTeamId: null,
    attempted: [],
    turnTeamId: teamIds[0] || null,
    revealed: false,
    finalWagers: {},
    finalJudged: {},
  };
}

function nextTurn(state) {
  const i = state.teamIds.indexOf(state.turnTeamId);
  return state.teamIds[(i + 1) % state.teamIds.length] || null;
}

function closeClue(state) {
  // mark used, clear clue context, then advance round/final if board is done
  const used = { ...state.used, [`${state.roundIndex}:${state.active.cat}:${state.active.row}`]: true };
  let s = {
    ...state, used, phase: 'board', active: null, isDailyDouble: false,
    wager: null, answeringTeamId: null, attempted: [], revealed: false,
  };
  if (currentRound(s).mode === 'turns') s = { ...s, turnTeamId: nextTurn(s) };
  if (!boardDone(s)) return s;
  if (s.roundIndex + 1 < s.set.rounds.length) {
    return { ...s, roundIndex: s.roundIndex + 1, phase: 'round-intro', cursor: { cat: 0, row: 0 } };
  }
  return s.set.final ? { ...s, phase: 'final-category' } : { ...s, phase: 'done' };
}

function moveCursor(state, dir) {
  const round = currentRound(state);
  const cats = round.categories.length;
  let { cat, row } = state.cursor;
  if (dir === 'left') cat = Math.max(0, cat - 1);
  if (dir === 'right') cat = Math.min(cats - 1, cat + 1);
  if (dir === 'up') row = Math.max(0, row - 1);
  if (dir === 'down') row = row + 1;
  row = Math.min(row, round.categories[cat].clues.length - 1);
  return { ...state, cursor: { cat, row } };
}

export function jeopardyReducer(state, action) {
  const round = currentRound(state);
  switch (action.type) {
    case 'RESTORE':
      return { ...state, ...action.snapshot, set: state.set };

    case 'START_ROUND':
      if (state.phase === 'round-intro') return { ...state, phase: 'board' };
      if (state.phase === 'final-category') return { ...state, phase: 'final-wager' };
      return state;

    case 'MOVE_CURSOR':
      return state.phase === 'board' ? moveCursor(state, action.dir) : state;

    case 'SELECT_TILE': {
      if (state.phase !== 'board') return state;
      const { cat, row } = state.cursor;
      const clue = clueAt(state, cat, row);
      if (!clue || isUsed(state, cat, row)) return state;
      const active = { cat, row, clue };
      if (clue.daily_double) {
        return { ...state, phase: 'wager', active, isDailyDouble: true, answeringTeamId: state.turnTeamId };
      }
      const answeringTeamId = round.mode === 'turns' ? state.turnTeamId : null;
      return { ...state, phase: 'clue', active, answeringTeamId, revealed: false, attempted: [] };
    }

    case 'SET_WAGER':
      if (state.phase !== 'wager') return state;
      return { ...state, phase: 'clue', wager: action.amount, revealed: false };

    case 'BUZZ': {
      if (state.phase !== 'clue' || state.isDailyDouble || round.mode === 'turns') return state;
      if (state.answeringTeamId || state.attempted.includes(action.teamId)) return state;
      const revealed = round.mode === 'self' ? true : state.revealed;
      return { ...state, phase: 'judging', answeringTeamId: action.teamId, revealed };
    }

    case 'REVEAL':
      if (state.phase === 'clue') return { ...state, revealed: true, phase: state.answeringTeamId ? 'judging' : state.phase };
      if (state.phase === 'final-clue') return { ...state, phase: 'final-judging' };
      return state;

    case 'JUDGE': {
      if (state.phase !== 'judging') return state;
      if (action.correct) return closeClue({ ...state, turnTeamId: state.answeringTeamId || state.turnTeamId });
      // wrong:
      if (state.isDailyDouble || round.mode !== 'hosted') return closeClue(state);
      const attempted = [...state.attempted, state.answeringTeamId];
      if (attempted.length >= state.teamIds.length) {
        // everyone missed — show the answer, host returns to board
        return { ...state, phase: 'clue', attempted, answeringTeamId: null, revealed: true };
      }
      return { ...state, phase: 'clue', attempted, answeringTeamId: null };
    }

    case 'TIMEOUT':
      if (state.phase !== 'clue' && state.phase !== 'judging') return state;
      return { ...state, phase: 'clue', revealed: true, answeringTeamId: null };

    case 'RETURN_TO_BOARD':
      if (state.phase !== 'clue' || !state.revealed) return state;
      return closeClue(state);

    case 'SET_FINAL_WAGER': {
      if (state.phase !== 'final-wager') return state;
      const finalWagers = { ...state.finalWagers, [action.teamId]: action.amount };
      const allIn = state.teamIds.every((id) => finalWagers[id] != null);
      return { ...state, finalWagers, phase: allIn ? 'final-clue' : 'final-wager' };
    }

    case 'JUDGE_FINAL': {
      if (state.phase !== 'final-judging') return state;
      const finalJudged = { ...state.finalJudged, [action.teamId]: action.correct };
      const allJudged = state.teamIds.every((id) => finalJudged[id] != null);
      return { ...state, finalJudged, phase: allJudged ? 'done' : 'final-judging' };
    }

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/games/Jeopardy/jeopardyReducer.*
git commit -m "feat(jeopardy): pure round state machine — modes, daily double, final"
```

### Task 14: Host input keymap

**Files:**
- Create: `frontend/src/modules/GameShow/games/Jeopardy/keymap.js`
- Test: `frontend/src/modules/GameShow/games/Jeopardy/keymap.test.js`

**Interfaces:**
- Consumes: reducer phases from Task 13. Input keys arrive as `KeyboardEvent.key` — the GamepadAdapter already synthesizes `ArrowUp/Down/Left/Right`, `Enter`, `Escape` keydowns (`frontend/src/screen-framework/input/adapters/GamepadAdapter.js`), so gamepad works for free.
- Produces: `resolveJeopardyKey({ phase, revealed, answeringTeamId, key }) → action|null` (a Task-13 action object). Mapping (shown in ControlLegend):
  - `board`: arrows → `MOVE_CURSOR`, Enter → `SELECT_TILE`
  - `clue` (unrevealed, nobody answering): Escape → `TIMEOUT`
  - `clue` (revealed): Enter → `RETURN_TO_BOARD`
  - `judging`: ArrowUp → `JUDGE correct:true`, ArrowDown → `JUDGE correct:false`, Enter (unrevealed) → `REVEAL`
  - `final-clue`: Enter → `REVEAL`
  - everything else (wager panels, intros' Continue buttons): `null` — those phases use focusable buttons.

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/modules/GameShow/games/Jeopardy/keymap.test.js
import { describe, it, expect } from 'vitest';
import { resolveJeopardyKey } from './keymap.js';

describe('resolveJeopardyKey', () => {
  it('board: arrows move, enter selects', () => {
    expect(resolveJeopardyKey({ phase: 'board', key: 'ArrowLeft' })).toEqual({ type: 'MOVE_CURSOR', dir: 'left' });
    expect(resolveJeopardyKey({ phase: 'board', key: 'ArrowDown' })).toEqual({ type: 'MOVE_CURSOR', dir: 'down' });
    expect(resolveJeopardyKey({ phase: 'board', key: 'Enter' })).toEqual({ type: 'SELECT_TILE' });
  });
  it('clue: escape times out; enter returns when revealed', () => {
    expect(resolveJeopardyKey({ phase: 'clue', revealed: false, key: 'Escape' })).toEqual({ type: 'TIMEOUT' });
    expect(resolveJeopardyKey({ phase: 'clue', revealed: true, key: 'Enter' })).toEqual({ type: 'RETURN_TO_BOARD' });
    expect(resolveJeopardyKey({ phase: 'clue', revealed: false, key: 'Enter' })).toBe(null);
  });
  it('judging: up=correct, down=wrong, enter reveals if hidden', () => {
    expect(resolveJeopardyKey({ phase: 'judging', revealed: true, key: 'ArrowUp' })).toEqual({ type: 'JUDGE', correct: true });
    expect(resolveJeopardyKey({ phase: 'judging', revealed: true, key: 'ArrowDown' })).toEqual({ type: 'JUDGE', correct: false });
    expect(resolveJeopardyKey({ phase: 'judging', revealed: false, key: 'Enter' })).toEqual({ type: 'REVEAL' });
  });
  it('final-clue: enter reveals; unknown phases/keys → null', () => {
    expect(resolveJeopardyKey({ phase: 'final-clue', key: 'Enter' })).toEqual({ type: 'REVEAL' });
    expect(resolveJeopardyKey({ phase: 'wager', key: 'Enter' })).toBe(null);
    expect(resolveJeopardyKey({ phase: 'board', key: 'x' })).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/GameShow/games/Jeopardy/keymap.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the keymap**

```js
// frontend/src/modules/GameShow/games/Jeopardy/keymap.js
// Host-input matrix (keyboard + GamepadAdapter synthetic keys).
// Wager/intro phases return null — they use focusable buttons instead.

const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export function resolveJeopardyKey({ phase, revealed = false, key }) {
  if (phase === 'board') {
    if (ARROWS[key]) return { type: 'MOVE_CURSOR', dir: ARROWS[key] };
    if (key === 'Enter') return { type: 'SELECT_TILE' };
    return null;
  }
  if (phase === 'clue') {
    if (key === 'Escape' && !revealed) return { type: 'TIMEOUT' };
    if (key === 'Enter' && revealed) return { type: 'RETURN_TO_BOARD' };
    return null;
  }
  if (phase === 'judging') {
    if (key === 'ArrowUp') return { type: 'JUDGE', correct: true };
    if (key === 'ArrowDown') return { type: 'JUDGE', correct: false };
    if (key === 'Enter' && !revealed) return { type: 'REVEAL' };
    return null;
  }
  if (phase === 'final-clue' && key === 'Enter') return { type: 'REVEAL' };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/GameShow/games/Jeopardy/keymap.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/GameShow/games/Jeopardy/keymap.*
git commit -m "feat(jeopardy): host input keymap (d-pad judge controls)"
```

### Task 15: Board + Clue screen UI

**Files:**
- Create: `frontend/src/modules/GameShow/games/Jeopardy/Board.jsx`
- Create: `frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx`
- Create: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss`

**Interfaces:**
- Consumes: Task 13 state/helpers, Task 12 `RevealPanel`/`MediaCluePlayer`/`ControlLegend`, Task 10 `TimerRing`/`useCountdown`.
- Produces:
  - `<Board round used roundIndex cursor />` — category header row + value grid; `used` tiles blank out; cursor tile highlighted. Pure display — navigation state comes from the reducer.
  - `<ClueScreen state teams remaining progress lockedTeam />` — full-screen clue: value banner, `MediaCluePlayer` (with text fallback on `onError`), `RevealPanel`, buzz banner for the locked team, `TimerRing`, judge hints via `ControlLegend`.
- Both are presentation-only (no dispatch) — Task 17's `Jeopardy.jsx` owns state and input.

- [ ] **Step 1: Write the components**

```jsx
// frontend/src/modules/GameShow/games/Jeopardy/Board.jsx
import React from 'react';
import './Jeopardy.scss';

export function Board({ round, used, roundIndex, cursor }) {
  const rows = Math.max(...round.categories.map((c) => c.clues.length));
  return (
    <div className="jp-board" data-testid="jeopardy-board"
      style={{ '--cats': round.categories.length, '--rows': rows }}>
      {round.categories.map((cat, c) => (
        <div key={cat.name + c} className="jp-board__cat">{cat.name}</div>
      ))}
      {Array.from({ length: rows }).flatMap((_, r) =>
        round.categories.map((cat, c) => {
          const clue = cat.clues[r] || null;
          const isUsed = !!used[`${roundIndex}:${c}:${r}`];
          const isCursor = cursor.cat === c && cursor.row === r;
          return (
            <div key={`${c}:${r}`}
              className={`jp-board__tile${isUsed || !clue ? ' is-used' : ''}${isCursor ? ' is-cursor' : ''}`}>
              {!isUsed && clue ? `$${clue.value * round.multiplier}` : ''}
            </div>
          );
        })
      )}
    </div>
  );
}
export default Board;
```

```jsx
// frontend/src/modules/GameShow/games/Jeopardy/ClueScreen.jsx
import React, { useState } from 'react';
import RevealPanel from '../../shell/components/RevealPanel.jsx';
import MediaCluePlayer from '../../shell/components/MediaCluePlayer.jsx';
import ControlLegend from '../../shell/components/ControlLegend.jsx';
import TimerRing from '../../shell/timers/TimerRing.jsx';
import './Jeopardy.scss';

export function ClueScreen({ state, teams, progress = 1, lockedTeam = null }) {
  const [mediaError, setMediaError] = useState(null);
  const { active, revealed, isDailyDouble, wager } = state;
  if (!active) return null;
  const round = state.set.rounds[state.roundIndex];
  const value = isDailyDouble ? wager : active.clue.value * round.multiplier;
  const judging = state.phase === 'judging';
  const legend = judging
    ? [{ key: '↑', label: 'Correct' }, { key: '↓', label: 'Wrong' }, ...(revealed ? [] : [{ key: '↵', label: 'Show answer' }])]
    : revealed
      ? [{ key: '↵', label: 'Back to board' }]
      : [{ key: 'Esc', label: 'Time out' }];

  return (
    <div className="jp-clue" data-testid="clue-screen">
      <div className="jp-clue__banner">
        {isDailyDouble && <span className="jp-clue__dd">DAILY DOUBLE</span>}
        <span className="jp-clue__value">${value?.toLocaleString?.() ?? value}</span>
        <TimerRing progress={progress} size={72} />
      </div>
      {active.clue.media && !mediaError && (
        <MediaCluePlayer media={active.clue.media} onError={setMediaError} />
      )}
      {mediaError && <div className="jp-clue__media-error">{mediaError}</div>}
      <RevealPanel prompt={active.clue.clue} revealed={revealed} answer={active.clue.answer} />
      {lockedTeam && (
        <div className="jp-clue__locked" style={{ '--team-color': lockedTeam.color }}>
          {lockedTeam.name} buzzed in!
        </div>
      )}
      <ControlLegend items={legend} />
    </div>
  );
}
export default ClueScreen;
```

```scss
// frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.scss
.jp-board {
  display: grid;
  grid-template-columns: repeat(var(--cats), 1fr);
  gap: 0.5rem;
  padding: 1.5rem;
  flex: 1;

  &__cat {
    background: #0a1bb0;
    display: flex; align-items: center; justify-content: center; text-align: center;
    font-weight: 800; font-size: 1.4rem; text-transform: uppercase; padding: 0.75rem;
    border-radius: 0.25rem; text-shadow: 0.1rem 0.1rem 0 #000;
  }
  &__tile {
    background: #0a1bb0; border-radius: 0.25rem;
    display: flex; align-items: center; justify-content: center;
    font-size: 2.4rem; font-weight: 800; color: #ffd54a; text-shadow: 0.12rem 0.12rem 0 #000;
    min-height: 5.5rem;
    &.is-used { background: rgba(10, 27, 176, 0.25); }
    &.is-cursor { outline: 0.3rem solid #fff; z-index: 1; }
  }
}
.jp-clue {
  height: 100%; display: flex; flex-direction: column; align-items: center; padding: 1rem;
  &__banner { display: flex; gap: 1.5rem; align-items: center; font-size: 2rem; font-weight: 800; }
  &__dd { color: #ffd54a; letter-spacing: 0.15em; animation: gs-pulse 1.2s infinite; }
  &__value { color: #ffd54a; }
  &__locked {
    font-size: 2rem; font-weight: 800; padding: 0.75rem 2rem; border-radius: 0.75rem;
    background: var(--team-color); animation: gs-pulse 0.9s infinite;
  }
  &__media-error { opacity: 0.6; font-style: italic; }
}
```

- [ ] **Step 2: Verify build + existing tests still pass**

Run: `npx vitest run frontend/src/modules/GameShow && npx vite build --logLevel error`
Expected: tests PASS; build clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/GameShow/games/Jeopardy/
git commit -m "feat(jeopardy): board grid + clue screen presentation components"
```

### Task 16: Final round + results screens

**Files:**
- Create: `frontend/src/modules/GameShow/games/Jeopardy/FinalRound.jsx`
- Create: `frontend/src/modules/GameShow/games/Jeopardy/Results.jsx`

**Interfaces:**
- Consumes: Task 12 `TitleCard`/`RevealPanel`/`WagerPanel`/`MediaCluePlayer` + `clampWager`; Task 13 final phases/actions; scores from Task 9.
- Produces:
  - `<FinalRound state teams scores onAction />` — renders by phase: `final-category` (TitleCard + Continue button → `onAction({type:'START_ROUND'})`), `final-wager` (host enters each un-wagered team's wager in turn via `WagerPanel`; the amount is entered by the HOST — the panel shows the team name; after confirm, only "wager locked" is displayed — spec §3.3; `roundMax` for Final = highest clue value × multiplier of the LAST round), `final-clue` (clue + RevealPanel unrevealed + legend "↵ Reveal"), `final-judging` (per-team judge list: for each team in order, Correct/Wrong buttons → `onAction({type:'JUDGE_FINAL', teamId, correct})`; the caller applies score deltas from `finalWagers`).
  - `<Results teams scores onPlayAgain onExit />` — teams sorted by score, winner banner, two buttons.

- [ ] **Step 1: Write the components**

```jsx
// frontend/src/modules/GameShow/games/Jeopardy/FinalRound.jsx
import React, { useState } from 'react';
import TitleCard from '../../shell/components/TitleCard.jsx';
import RevealPanel from '../../shell/components/RevealPanel.jsx';
import MediaCluePlayer from '../../shell/components/MediaCluePlayer.jsx';
import WagerPanel from '../../shell/components/WagerPanel.jsx';
import ControlLegend from '../../shell/components/ControlLegend.jsx';
import './Jeopardy.scss';

function finalRoundMax(set) {
  const last = set.rounds[set.rounds.length - 1];
  return Math.max(...last.categories.flatMap((c) => c.clues.map((q) => q.value))) * last.multiplier;
}

export function FinalRound({ state, teams, scores, onAction }) {
  const { phase, set, finalWagers, finalJudged } = state;
  const [draft, setDraft] = useState(100);

  if (phase === 'final-category') {
    return (
      <div className="jp-final">
        <TitleCard title="Final Jeopardy" subtitle={set.final.category} />
        <button type="button" autoFocus onClick={() => onAction({ type: 'START_ROUND' })}>Continue</button>
      </div>
    );
  }

  if (phase === 'final-wager') {
    const pending = teams.find((t) => finalWagers[t.id] == null);
    const lockedNames = teams.filter((t) => finalWagers[t.id] != null).map((t) => t.name);
    return (
      <div className="jp-final">
        {lockedNames.length > 0 && <div className="jp-final__locked">Wagers locked: {lockedNames.join(', ')}</div>}
        <WagerPanel
          teamName={pending.name}
          score={Math.max(scores[pending.id] ?? 0, 0)}
          roundMax={finalRoundMax(set)}
          value={draft}
          onChange={setDraft}
          onConfirm={(amount) => { onAction({ type: 'SET_FINAL_WAGER', teamId: pending.id, amount }); setDraft(100); }}
        />
      </div>
    );
  }

  if (phase === 'final-clue') {
    return (
      <div className="jp-final">
        {set.final.media && <MediaCluePlayer media={set.final.media} />}
        <RevealPanel prompt={set.final.clue} revealed={false} />
        <ControlLegend items={[{ key: '↵', label: 'Reveal answer' }]} />
      </div>
    );
  }

  if (phase === 'final-judging') {
    return (
      <div className="jp-final">
        <RevealPanel prompt={set.final.clue} revealed answer={set.final.answer} />
        <div className="jp-final__judging">
          {teams.map((team) => (
            <div key={team.id} className="jp-final__team">
              <span>{team.name} (wagered {finalWagers[team.id]})</span>
              {finalJudged[team.id] == null ? (
                <>
                  <button type="button" onClick={() => onAction({ type: 'JUDGE_FINAL', teamId: team.id, correct: true })}>Correct</button>
                  <button type="button" onClick={() => onAction({ type: 'JUDGE_FINAL', teamId: team.id, correct: false })}>Wrong</button>
                </>
              ) : (
                <span>{finalJudged[team.id] ? '✓' : '✗'}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
export default FinalRound;
```

```jsx
// frontend/src/modules/GameShow/games/Jeopardy/Results.jsx
import React from 'react';
import TitleCard from '../../shell/components/TitleCard.jsx';
import './Jeopardy.scss';

export function Results({ teams, scores, onPlayAgain, onExit }) {
  const ranked = [...teams].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  const winner = ranked[0];
  return (
    <div className="jp-results" data-testid="results">
      <TitleCard title={`${winner?.name || '—'} wins!`} subtitle="Final scores" />
      <ol className="jp-results__list">
        {ranked.map((t) => (
          <li key={t.id} style={{ '--team-color': t.color }}>
            {t.name}: {(scores[t.id] ?? 0).toLocaleString()}
          </li>
        ))}
      </ol>
      <div className="jp-results__actions">
        <button type="button" autoFocus onClick={onPlayAgain}>Play again</button>
        <button type="button" onClick={onExit}>Exit</button>
      </div>
    </div>
  );
}
export default Results;
```

Add to `Jeopardy.scss`:

```scss
.jp-final {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5rem;
  &__locked { opacity: 0.75; font-size: 1.2rem; }
  &__judging { display: flex; flex-direction: column; gap: 1rem; }
  &__team { display: flex; gap: 1rem; align-items: center; font-size: 1.5rem;
    button { font-size: 1.1rem; padding: 0.5rem 1.25rem; border-radius: 0.5rem; border: none; cursor: pointer;
      background: rgba(255,255,255,0.15); color: #fff; &:focus { outline: 3px solid #ffd54a; } } }
}
.jp-results {
  height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
  &__list { font-size: 1.8rem; li { margin: 0.4rem 0; border-left: 0.4rem solid var(--team-color); padding-left: 0.75rem; } }
  &__actions { display: flex; gap: 1rem;
    button { font-size: 1.2rem; padding: 0.75rem 1.75rem; border-radius: 0.5rem; border: none; cursor: pointer;
      background: #ffd54a; color: #111; font-weight: 700; &:focus { outline: 3px solid #fff; } } }
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npx vitest run frontend/src/modules/GameShow && npx vite build --logLevel error`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/GameShow/games/Jeopardy/
git commit -m "feat(jeopardy): final round + results screens"
```

### Task 17: Full assembly — Jeopardy.jsx + GameShow.jsx + registry

**Files:**
- Create: `frontend/src/modules/GameShow/games/registry.js`
- Create: `frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.jsx`
- Modify: `frontend/src/modules/GameShow/GameShow.jsx` (replace the Task-6 skeleton body)
- Test: `frontend/src/modules/GameShow/games/Jeopardy/integration.test.js` (reducer-level integration: full game with score application)

**Interfaces:**
- `games/registry.js` exports `GAME_REGISTRY = { jeopardy: { id: 'jeopardy', title: 'Jeopardy', component: Jeopardy } }`.
- `<Jeopardy setId teams sessionId resumeState buzzerBindings config onFinished />` owns: fetching the set (`DaylightAPI('api/v1/gameshow/games/jeopardy/sets/' + setId)`), the Task-13 reducer, Task-9 scores, Task-8 buzzers, Task-10 audio/timer, keydown listener → Task-14 keymap, and checkpointing via a Task-7 `makeCheckpointer` (`push(sessionId, { jeopardy: snapshot(state), scores, buzzers: arbiter.snapshot() })` in a `useEffect` on every state change). On `phase === 'done'` → `finishSession` + `onFinished(scores)`.
- `GameShow.jsx` final assembly renders per flow phase: resume-gate (Resume/Discard buttons), set-picker (valid sets as focusable buttons; invalid sets rendered disabled with their error), team-setup (Task 11), buzzer-bind (per-team "Press your buzzer" bind using Task 8 `startBind`, with a Skip button — no hardware required), playing (mounts the registry component; creates the session first via Task 7 `createSession` if `sessionId` is null), results (Task 16 `Results`).

**Key integration rules (implementers: read carefully):**
1. Score application: on JUDGE / JUDGE_FINAL / daily-double outcomes, compute the delta BEFORE dispatching to the jeopardy reducer:

```js
// inside Jeopardy.jsx — the single place scores change
const applyJudge = (correct) => {
  const d = scoreDelta(state, correct);
  if (d && d.delta !== 0) dispatchScores({ type: d.delta > 0 ? 'AWARD' : 'DEDUCT', teamId: d.teamId, points: Math.abs(d.delta) });
  dispatchGame({ type: 'JUDGE', correct });
};
const applyFinalJudge = (teamId, correct) => {
  const wager = state.finalWagers[teamId] || 0;
  if (wager > 0) dispatchScores({ type: correct ? 'AWARD' : 'DEDUCT', teamId, points: wager });
  dispatchGame({ type: 'JUDGE_FINAL', teamId, correct });
};
```

2. Buzzer arming: a `useEffect` watching `state.phase`/`state.attempted` — when `phase === 'clue' && !isDailyDouble && mode !== 'turns' && !revealed`, `arm(teamIds not in attempted)`; otherwise `disarm()`. `onLock` → `dispatchGame({ type: 'BUZZ', teamId })` + `audio.play('buzz')`.
3. Audio cues: `SELECT_TILE` → `play('reveal')`; daily double → `play('daily-double')`; correct → `play('correct')`; wrong/timeout → `play('wrong')`; `final-clue` reveal → `play('think', { channel: 'music', loop: true })`, stopped on `final-judging`; `done` → `play('win')`. Media clues: when `active.clue.media?.type === 'audio'|'video'`, call `audio.duck('music')` while mounted (MediaCluePlayer plays natively; the engine's `clue-media` channel is for engine-played files — native elements just need the duck).
4. Timer: `useCountdown({ seconds: round.timer_seconds ?? config.defaults.timer_seconds, running: phase === 'clue' && !revealed, onExpire: () => dispatchGame({ type: 'TIMEOUT' }) })`. Reset by keying the hook on `state.active` (remount `ClueScreen` with `key={\`${active?.cat}:${active?.row}:${attempted.length}\`}`).
5. Keydown: window listener resolving via `resolveJeopardyKey({ phase, revealed, answeringTeamId, key: e.key })`, dispatching non-null actions. Ignore keys when a button-driven phase has focus targets (`wager`, `final-wager`, `final-judging`, `round-intro` — the keymap already returns null for those). Digits are consumed by useBuzzers' fallback listener — don't double-handle them here.
6. Resume: if `resumeState` prop is present, after the set loads dispatch `{ type: 'RESTORE', snapshot: resumeState.jeopardy }`, `dispatchScores({ type: 'RESTORE', scores: resumeState.scores })`, `arbiter.restore(resumeState.buzzers)`.

- [ ] **Step 1: Write the failing integration test (reducer + scores together)**

```js
// frontend/src/modules/GameShow/games/Jeopardy/integration.test.js
// Plays a full 2-clue game through the reducers exactly as Jeopardy.jsx does,
// asserting the score bookkeeping contract between jeopardyReducer and scoreReducer.
import { describe, it, expect } from 'vitest';
import { initJeopardy, jeopardyReducer, scoreDelta } from './jeopardyReducer.js';
import { scoreReducer, initScores } from '../../shell/scoreboard/scoreReducer.js';

const TEAMS = [{ id: 'team_1' }, { id: 'team_2' }];
const SET = {
  id: 's', title: 'S', description: '',
  rounds: [{
    name: 'R1', mode: 'hosted', multiplier: 2, timer_seconds: null, penalize_wrong: true,
    categories: [{ name: 'C', clues: [
      { value: 100, clue: 'q1', answer: 'a1', media: null, daily_double: false },
      { value: 200, clue: 'q2', answer: 'a2', media: null, daily_double: false },
    ] }],
  }],
  final: { category: 'F', clue: 'fq', answer: 'fa', media: null },
};

function judge(game, scores, correct) {
  const d = scoreDelta(game, correct);
  const nextScores = d && d.delta !== 0
    ? scoreReducer(scores, { type: d.delta > 0 ? 'AWARD' : 'DEDUCT', teamId: d.teamId, points: Math.abs(d.delta) })
    : scores;
  return [jeopardyReducer(game, { type: 'JUDGE', correct }), nextScores];
}

it('full hosted game: wrong then right, final wagers settle correctly', () => {
  let game = jeopardyReducer(initJeopardy(SET, TEAMS.map((t) => t.id)), { type: 'START_ROUND' });
  let scores = initScores(TEAMS);

  // clue 1 (value 100 × mult 2 = 200): team_1 wrong (−200), team_2 right (+200)
  game = jeopardyReducer(game, { type: 'SELECT_TILE' });
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_1' });
  [game, scores] = judge(game, scores, false);
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_2' });
  [game, scores] = judge(game, scores, true);
  expect(scores).toEqual({ team_1: -200, team_2: 200 });

  // clue 2 (400): team_2 right again
  game = jeopardyReducer(game, { type: 'MOVE_CURSOR', dir: 'down' });
  game = jeopardyReducer(game, { type: 'SELECT_TILE' });
  game = jeopardyReducer(game, { type: 'BUZZ', teamId: 'team_2' });
  [game, scores] = judge(game, scores, true);
  expect(scores.team_2).toBe(600);
  expect(game.phase).toBe('final-category');

  // final: both wager, team_1 right, team_2 wrong
  game = jeopardyReducer(game, { type: 'START_ROUND' });
  game = jeopardyReducer(game, { type: 'SET_FINAL_WAGER', teamId: 'team_1', amount: 5 });
  game = jeopardyReducer(game, { type: 'SET_FINAL_WAGER', teamId: 'team_2', amount: 600 });
  game = jeopardyReducer(game, { type: 'REVEAL' });
  scores = scoreReducer(scores, { type: 'AWARD', teamId: 'team_1', points: 5 });
  game = jeopardyReducer(game, { type: 'JUDGE_FINAL', teamId: 'team_1', correct: true });
  scores = scoreReducer(scores, { type: 'DEDUCT', teamId: 'team_2', points: 600 });
  game = jeopardyReducer(game, { type: 'JUDGE_FINAL', teamId: 'team_2', correct: false });
  expect(game.phase).toBe('done');
  expect(scores).toEqual({ team_1: -195, team_2: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run frontend/src/modules/GameShow/games/Jeopardy/integration.test.js`
Expected: PASS immediately (it exercises Tasks 9+13 code, both already built). If it FAILS, the reducer contract drifted — fix the reducer, not the test.

- [ ] **Step 3: Write registry + Jeopardy.jsx**

```js
// frontend/src/modules/GameShow/games/registry.js
import Jeopardy from './Jeopardy/Jeopardy.jsx';

export const GAME_REGISTRY = {
  jeopardy: { id: 'jeopardy', title: 'Jeopardy', component: Jeopardy },
};
```

```jsx
// frontend/src/modules/GameShow/games/Jeopardy/Jeopardy.jsx
// Game orchestrator: owns the reducer, scores, buzzers, audio, timer, and
// checkpointing. Presentation is delegated to Board/ClueScreen/FinalRound.
import React, { useReducer, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { initJeopardy, jeopardyReducer, scoreDelta, snapshot, currentRound } from './jeopardyReducer.js';
import { resolveJeopardyKey } from './keymap.js';
import { scoreReducer, initScores } from '../../shell/scoreboard/scoreReducer.js';
import Scoreboard from '../../shell/scoreboard/Scoreboard.jsx';
import { useBuzzers } from '../../shell/buzzers/useBuzzers.js';
import { useCountdown } from '../../shell/timers/useCountdown.js';
import { AudioCueEngine } from '../../shell/audio/AudioCueEngine.js';
import { makeCheckpointer, finishSession } from '../../shell/session/sessionClient.js';
import TitleCard from '../../shell/components/TitleCard.jsx';
import WagerPanel from '../../shell/components/WagerPanel.jsx';
import Board from './Board.jsx';
import ClueScreen from './ClueScreen.jsx';
import FinalRound from './FinalRound.jsx';

export default function Jeopardy({ setId, teams, sessionId, resumeState = null, buzzerBindings = null, config, onFinished }) {
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, dispatchGame] = useReducer(jeopardyReducer, null, () => initJeopardy({ rounds: [], final: null }, teamIds));
  const [scores, dispatchScores] = useReducer(scoreReducer, teams, initScores);
  const audio = useMemo(() => new AudioCueEngine({ pack: config?.sounds?.pack, mute: config?.defaults?.mute }), [config]);
  const checkpointer = useMemo(() => makeCheckpointer(), []);
  const startedRef = useRef(false);

  const { arbiter, locked, arm, disarm } = useBuzzers({
    teams,
    onLock: (teamId) => { audio.play('buzz'); dispatchGame({ type: 'BUZZ', teamId }); },
  });

  // Press-to-bind results from the bind phase override team default slots.
  // (resumeState.buzzers, applied in the load effect, wins over these.)
  useEffect(() => {
    if (buzzerBindings) arbiter.restore({ slotToTeam: buzzerBindings });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply once on mount
  }, []);

  // Load the set, then (re)initialize the reducer with it.
  useEffect(() => {
    let cancelled = false;
    DaylightAPI(`api/v1/gameshow/games/jeopardy/sets/${setId}`)
      .then((loaded) => {
        if (cancelled) return;
        setSet(loaded);
        dispatchGame({ type: 'RESTORE', snapshot: { ...initJeopardy(loaded, teamIds), set: undefined } });
        // RESTORE keeps state.set, so re-init via a real init path:
        // (initJeopardy returned an object without set applied — see reducer RESTORE)
        if (resumeState) {
          dispatchGame({ type: 'RESTORE', snapshot: resumeState.jeopardy });
          dispatchScores({ type: 'RESTORE', scores: resumeState.scores });
          arbiter.restore(resumeState.buzzers);
        }
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  // The reducer needs `set` inside state; RESTORE preserves state.set, so seed
  // it once by swapping in a fully-initialized state when the set arrives.
  // (Implementation detail: see stateWithSet below.)
  const stateWithSet = set ? { ...state, set } : state;
  const round = set ? currentRound(stateWithSet) : null;

  // Buzzer arming window
  useEffect(() => {
    if (!round) return;
    const buzzable = stateWithSet.phase === 'clue' && !stateWithSet.isDailyDouble
      && round.mode !== 'turns' && !stateWithSet.revealed;
    if (buzzable) arm(teamIds.filter((id) => !stateWithSet.attempted.includes(id)));
    else disarm();
  }, [stateWithSet.phase, stateWithSet.attempted, stateWithSet.revealed, round, arm, disarm, teamIds, stateWithSet.isDailyDouble]);

  // Checkpoint every transition
  useEffect(() => {
    if (!sessionId || !set) return;
    checkpointer.push(sessionId, { jeopardy: snapshot(stateWithSet), scores, buzzers: arbiter.snapshot() });
  }, [stateWithSet, scores, sessionId, set, checkpointer, arbiter]);

  // Finish
  useEffect(() => {
    if (stateWithSet.phase === 'done' && !startedRef.current) {
      startedRef.current = true;
      audio.play('win');
      if (sessionId) { checkpointer.flush(); finishSession(sessionId); }
      onFinished?.(scores);
    }
  }, [stateWithSet.phase, scores, sessionId, audio, checkpointer, onFinished]);

  const applyJudge = useCallback((correct) => {
    const d = scoreDelta(stateWithSet, correct);
    if (d && d.delta !== 0) dispatchScores({ type: d.delta > 0 ? 'AWARD' : 'DEDUCT', teamId: d.teamId, points: Math.abs(d.delta) });
    audio.play(correct ? 'correct' : 'wrong');
    dispatchGame({ type: 'JUDGE', correct });
  }, [stateWithSet, audio]);

  const onGameAction = useCallback((action) => {
    if (action.type === 'JUDGE_FINAL') {
      const wager = stateWithSet.finalWagers[action.teamId] || 0;
      if (wager > 0) dispatchScores({ type: action.correct ? 'AWARD' : 'DEDUCT', teamId: action.teamId, points: wager });
      audio.play(action.correct ? 'correct' : 'wrong');
    }
    dispatchGame(action);
  }, [stateWithSet, audio]);

  // Host keys
  useEffect(() => {
    const onKey = (e) => {
      const action = resolveJeopardyKey({
        phase: stateWithSet.phase, revealed: stateWithSet.revealed,
        answeringTeamId: stateWithSet.answeringTeamId, key: e.key,
      });
      if (!action) return;
      if (action.type === 'JUDGE') applyJudge(action.correct);
      else {
        if (action.type === 'SELECT_TILE') audio.play('reveal');
        if (action.type === 'TIMEOUT') audio.play('wrong');
        dispatchGame(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stateWithSet.phase, stateWithSet.revealed, stateWithSet.answeringTeamId, applyJudge, audio]);

  // Clue timer
  const timerSeconds = round?.timer_seconds ?? config?.defaults?.timer_seconds ?? 12;
  const { progress } = useCountdown({
    seconds: timerSeconds,
    running: !!set && stateWithSet.phase === 'clue' && !stateWithSet.revealed,
    onExpire: () => { audio.play('wrong'); dispatchGame({ type: 'TIMEOUT' }); },
  });

  if (error) return <div className="gameshow__error">{error}</div>;
  if (!set) return <TitleCard title="Loading…" />;

  const lockedTeam = teams.find((t) => t.id === (stateWithSet.answeringTeamId || locked)) || null;
  const { phase } = stateWithSet;

  return (
    <div className="jeopardy" data-phase={phase}>
      {phase === 'round-intro' && (
        <div className="jp-final">
          <TitleCard title={round.name} subtitle={`${set.title} — round ${stateWithSet.roundIndex + 1}`} />
          <button type="button" autoFocus onClick={() => { audio.play('board-fill'); dispatchGame({ type: 'START_ROUND' }); }}>Start</button>
        </div>
      )}
      {phase === 'board' && (
        <Board round={round} used={stateWithSet.used} roundIndex={stateWithSet.roundIndex} cursor={stateWithSet.cursor} />
      )}
      {phase === 'wager' && (
        <WagerPanel
          teamName={teams.find((t) => t.id === stateWithSet.answeringTeamId)?.name || ''}
          score={Math.max(scores[stateWithSet.answeringTeamId] ?? 0, 0)}
          roundMax={Math.max(...round.categories.flatMap((c) => c.clues.map((q) => q.value))) * round.multiplier}
          value={100}
          onChange={() => {}}
          onConfirm={(amount) => dispatchGame({ type: 'SET_WAGER', amount })}
        />
      )}
      {(phase === 'clue' || phase === 'judging') && (
        <ClueScreen
          key={`${stateWithSet.active?.cat}:${stateWithSet.active?.row}:${stateWithSet.attempted.length}`}
          state={stateWithSet} teams={teams} progress={progress} lockedTeam={lockedTeam}
        />
      )}
      {['final-category', 'final-wager', 'final-clue', 'final-judging'].includes(phase) && (
        <FinalRound state={stateWithSet} teams={teams} scores={scores} onAction={onGameAction} />
      )}
      <Scoreboard teams={teams} scores={scores} lockedTeamId={stateWithSet.answeringTeamId} activeTeamId={stateWithSet.turnTeamId} />
    </div>
  );
}
```

**⚠ Known wrinkle for the implementer:** the reducer's `RESTORE` intentionally preserves `state.set`, and `initJeopardy` embeds the set in state — but this component fetches the set async, so it renders with `stateWithSet = { ...state, set }`. That spread happens on every render; the reducer's own `state.set` stays the empty placeholder. All reducer actions that read `state.set` therefore MUST go through `stateWithSet`… but the reducer itself reads `state.set` internally (e.g. `closeClue`). **Resolution (do this, not the spread-only version):** after the set loads, re-initialize the reducer with the real set using a dedicated action — add to the reducer:

```js
    case 'INIT_SET':
      return { ...initJeopardy(action.set, state.teamIds), ...(action.resume || {}), set: action.set };
```

and in the load effect replace the two RESTORE dispatches with:

```js
        dispatchGame({ type: 'INIT_SET', set: loaded, resume: resumeState?.jeopardy });
```

Then delete `stateWithSet` and use `state` directly everywhere (the reducer state now carries the real set). Add a test for `INIT_SET` in `jeopardyReducer.test.js`:

```js
  it('INIT_SET seeds the set and optionally resumes', () => {
    let s = initJeopardy({ rounds: [], final: null }, TEAM_IDS);
    s = jeopardyReducer(s, { type: 'INIT_SET', set: makeSet(), resume: null });
    expect(s.phase).toBe('round-intro');
    expect(s.set.rounds).toHaveLength(1);
  });
```

- [ ] **Step 4: Assemble GameShow.jsx (replace skeleton body)**

```jsx
// frontend/src/modules/GameShow/GameShow.jsx
import React, { useReducer, useEffect, useState, useCallback } from 'react';
import { useWebSocketStatus } from '@/hooks/useWebSocket.js';
import { flowReducer, initialFlowState } from './shell/flow/flowReducer.js';
import { fetchBoot, createSession } from './shell/session/sessionClient.js';
import TeamSetup from './shell/teams/TeamSetup.jsx';
import { useBuzzers } from './shell/buzzers/useBuzzers.js';
import TitleCard from './shell/components/TitleCard.jsx';
import Results from './games/Jeopardy/Results.jsx';
import { GAME_REGISTRY } from './games/registry.js';
import './GameShow.scss';

function BuzzerBind({ teams, onDone }) {
  const [bound, setBound] = useState({});
  const { arbiter, startBind, bindingTeamId } = useBuzzers({ teams, onLock: () => {} });
  // Bindings live in THIS phase's arbiter; onDone hands them to the flow so
  // the game's own arbiter can restore them (they'd be lost otherwise).
  return (
    <div className="gameshow__bind">
      <TitleCard title="Buzzer check" subtitle="Bind each team's buzzer, or skip" />
      {teams.map((team) => (
        <button key={team.id} type="button"
          className={bindingTeamId === team.id ? 'is-binding' : ''}
          onClick={() => { startBind(team.id); setBound((b) => ({ ...b, [team.id]: true })); }}>
          {team.name}: {bindingTeamId === team.id ? 'press your buzzer…' : (bound[team.id] ? 'bound ✓' : `default ${team.slot}`)}
        </button>
      ))}
      <button type="button" autoFocus onClick={() => onDone(arbiter.bindings())}>Start game</button>
    </div>
  );
}

export default function GameShow({ dismiss }) {
  const [flow, dispatchFlow] = useReducer(flowReducer, initialFlowState);
  const [finalScores, setFinalScores] = useState({});
  // Spec §9: WS disconnect badge — buzzer modes degrade to keyboard/inject.
  const { connected } = useWebSocketStatus();

  useEffect(() => {
    let cancelled = false;
    fetchBoot()
      .then(({ config, sets, activeSession }) => {
        if (!cancelled) dispatchFlow({ type: 'BOOT_LOADED', config, sets, activeSession });
      })
      .catch((err) => { if (!cancelled) dispatchFlow({ type: 'BOOT_FAILED', error: err.message }); });
    return () => { cancelled = true; };
  }, []);

  // Create the backend session when play starts without one (fresh game).
  useEffect(() => {
    if (flow.phase !== 'playing' || flow.sessionId) return;
    createSession({ game: flow.game, setId: flow.setId, teams: flow.teams })
      .then((session) => dispatchFlow({ type: 'SESSION_CREATED', sessionId: session.id }))
      .catch(() => { /* non-blocking: game is playable without checkpoints */ });
  }, [flow.phase, flow.sessionId, flow.game, flow.setId, flow.teams]);

  const onFinished = useCallback((scores) => { setFinalScores(scores); dispatchFlow({ type: 'GAME_FINISHED' }); }, []);

  const Game = GAME_REGISTRY[flow.game]?.component;

  return (
    <div className="gameshow" data-phase={flow.phase}>
      {flow.error && <div className="gameshow__error">{flow.error}</div>}
      {!connected && <div className="gameshow__ws-warn" title="Buzzers offline — keyboard still works">⚡</div>}

      {flow.phase === 'loading' && <TitleCard title="Game Show" subtitle="Loading…" />}

      {flow.phase === 'resume-gate' && (
        <div className="gameshow__resume">
          <TitleCard title="Resume game?" subtitle={`${flow.resumeSession.setId} — in progress`} />
          <button type="button" autoFocus onClick={() => dispatchFlow({ type: 'RESUME_ACCEPT' })}>Resume</button>
          <button type="button" onClick={() => dispatchFlow({ type: 'RESUME_DISCARD' })}>Start fresh</button>
        </div>
      )}

      {flow.phase === 'set-picker' && (
        <div className="gameshow__sets">
          <TitleCard title="Game Show" subtitle="Pick a game" />
          {flow.sets.map((s) => (
            <button key={s.id} type="button" disabled={!s.valid}
              onClick={() => dispatchFlow({ type: 'PICK_SET', setId: s.id })}>
              {s.title} {s.valid ? `(${s.roundCount} rounds)` : `— ${s.error}`}
            </button>
          ))}
          {flow.sets.length === 0 && <p>No game sets in data/content/games/jeopardy/</p>}
        </div>
      )}

      {flow.phase === 'team-setup' && (
        <TeamSetup config={flow.config} onConfirm={(teams) => dispatchFlow({ type: 'TEAMS_CONFIRMED', teams })} />
      )}

      {flow.phase === 'buzzer-bind' && (
        <BuzzerBind teams={flow.teams} onDone={(bindings) => dispatchFlow({ type: 'BIND_DONE', bindings })} />
      )}

      {flow.phase === 'playing' && Game && (
        <Game
          setId={flow.setId}
          teams={flow.teams}
          sessionId={flow.sessionId}
          resumeState={flow.resumeSession?.state || null}
          buzzerBindings={flow.buzzerBindings}
          config={flow.config}
          onFinished={onFinished}
        />
      )}

      {flow.phase === 'results' && (
        <Results teams={flow.teams} scores={finalScores}
          onPlayAgain={() => dispatchFlow({ type: 'PLAY_AGAIN' })}
          onExit={() => dismiss?.()} />
      )}
    </div>
  );
}
```

Add supporting styles to `GameShow.scss`:

```scss
.gameshow {
  &__error { color: #ff6b6b; font-size: 1.4rem; }
  &__ws-warn { position: absolute; top: 0.75rem; right: 0.75rem; opacity: 0.6; font-size: 1.2rem; }
  &__resume, &__sets, &__bind {
    height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;
    button {
      font-size: 1.3rem; padding: 0.75rem 2rem; border-radius: 0.5rem; border: none; cursor: pointer;
      background: rgba(255, 255, 255, 0.12); color: #fff;
      &:focus { outline: 3px solid #ffd54a; }
      &:disabled { opacity: 0.4; cursor: default; }
      &.is-binding { animation: gs-pulse 0.9s infinite; }
    }
  }
}
```

- [ ] **Step 5: Run everything + build**

Run: `npx vitest run frontend/src/modules/GameShow && npx vite build --logLevel error`
Expected: all module tests PASS; build clean. Fix any import/lint fallout now.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/GameShow/
git commit -m "feat(gameshow): full assembly — shell flow UI + Jeopardy orchestrator"
```

---

# Phase 4 — Content, sounds, docs, verification

### Task 18: Reference content, sound-pack contract, docs

**Files:**
- Create: `docs/reference/gameshow/README.md`
- Create: `docs/reference/gameshow/sample-set.yml`
- Create: `docs/reference/gameshow/sample-gameshow.yml`

**Interfaces:** none (documentation + deployable examples). The real files live on the DATA VOLUME, not in the repo — deploying them is an ops step done by the operator (`sudo docker exec` heredoc on kckern-server), documented here.

- [ ] **Step 1: Write the sample game set**

`docs/reference/gameshow/sample-set.yml` — a complete, playable 2-round set. Content requirements: round 1 `mode: hosted`, `multiplier: 1`, 3 categories × 3 clues with values 100/200/300, exactly one `daily_double: true`; round 2 `mode: turns`, `multiplier: 2`, 2 categories × 2 clues; a `final` block. Use general-knowledge family trivia (write real questions — e.g. animals, geography, "name that sound" placeholders WITHOUT media so the sample plays with zero media files). Header:

```yaml
id: sample-family-night
title: "Family Night Sampler"
description: "A starter game to verify the install — no media files needed"
```

- [ ] **Step 2: Write the sample household config**

`docs/reference/gameshow/sample-gameshow.yml`:

```yaml
# Deploy to: data/household/config/gameshow.yml
buzzers: []          # add when Zigbee buttons arrive:
# buzzers:
#   - id: living_room_buzzers
#     mqtt_topic: "zigbee2mqtt/GameShow Buzzer Panel"
#     buttons:
#       "1_single": slot_1
#       "2_single": slot_2
#       "3_single": slot_3
#       "4_single": slot_4
team_presets:
  - id: kids_vs_parents
    name: Kids vs Parents
    teams:
      - { name: Kids,    color: "#e6b325", members: [felix, milo, alan, soren] }
      - { name: Parents, color: "#3273dc", members: [kckern, cammy] }
defaults:
  timer_seconds: 12
  mute: false
sounds:
  pack: classic
```

(Verify the member usernames against `data/users/` profiles at deploy time; they are examples.)

- [ ] **Step 3: Write the README**

`docs/reference/gameshow/README.md` must contain, in full:
1. **Architecture overview** — 1 paragraph + pointer to the spec.
2. **Game set schema** — the full annotated YAML schema from spec §5 (copy it in; don't link-only).
3. **Sound pack contract** — packs live at `media/apps/gameshow/<pack>/`; the engine plays `<cue>.mp3` by name; cue names used by Jeopardy: `buzz`, `correct`, `wrong`, `reveal`, `board-fill`, `daily-double`, `think`, `win`. Missing files are silent no-ops, so an empty pack is valid (the game plays silently until sounds are added).
4. **Deploy steps** (kckern-server): heredoc-write `gameshow.yml` to `data/household/config/`, game sets to `data/content/games/jeopardy/`, sounds to `media/apps/gameshow/classic/` — with the exact `sudo docker exec daylight-station sh -c 'cat > … << EOF'` commands (mirror the CLAUDE.local.md idiom; never `sed -i`).
5. **AI game-set generation prompt** — a fenced prompt block that instructs any chatbot to emit a valid set YAML: include the schema, the value conventions (100–500 per 5-clue category), instructions to mark exactly one daily double per round, `mode` choices explained, and "output ONLY the YAML". (Pattern borrowed from Party-Jeopardy's AI import flow.)
6. **Playing without hardware** — keyboard digits 1–9 buzz slots 1–9; `POST /api/v1/gameshow/buzz {"slot":"slot_1"}` injects a buzz; gamepad d-pad/Enter/Escape drive the host controls (GamepadAdapter synthesizes those keys).

- [ ] **Step 4: Commit**

```bash
git add docs/reference/gameshow/
git commit -m "docs(gameshow): schemas, sound-pack contract, AI set-generation prompt, deploy steps"
```

### Task 19: Full verification pass

**Files:** none created — this is the gate before handoff.

- [ ] **Step 1: Run the entire new test surface**

Run: `npx vitest run backend/src/2_domains/gameshow backend/src/3_applications/gameshow backend/src/4_api/v1/routers/gameshow.test.mjs frontend/src/modules/GameShow`
Expected: ALL PASS. Fix anything red before proceeding.

- [ ] **Step 2: Regression: neighbor suites still green**

Run: `npx vitest run backend/src/4_api/v1/routers/emulator.test.mjs frontend/src/screen-framework`
Expected: PASS (api.mjs and builtins.js were modified; these cover the blast radius).

- [ ] **Step 3: Production build**

Run: `npx vite build --logLevel error`
Expected: clean build.

- [ ] **Step 4: Manual smoke (dev browser, no hardware)**

1. Start dev: `npm run start:dev` (backend 3112 + vite).
2. Deploy the sample set + config into the dev data dir (or the container volume per Task 18 README).
3. Open the screen route that mounts widget `gameshow` (any screen config; or add it to a test screen).
4. Walk: set-picker → pick sample → team setup (load preset, move a member) → buzzer bind (Skip) → round intro → board: arrows + Enter → clue shows, timer ring runs → press `1` (buzz) → ↑ correct → score +100 → play a daily double (wager panel) → exhaust round 1 → round 2 intro (turns mode: no buzzing, rotation badge moves) → final: wagers → reveal → judge both → results shows winner.
5. Reload mid-game (F5) → resume-gate appears → Resume restores board, scores, and used tiles.
6. `curl -X POST localhost:3112/api/v1/gameshow/buzz -H 'Content-Type: application/json' -d '{"slot":"slot_2"}'` while a clue is open → team 2 locks in.
Expected: every step behaves as described; log any deviation as a bug and fix before handoff.

- [ ] **Step 5: Final commit + wrap-up**

```bash
git status          # should be clean except intentional changes
git log --oneline   # one commit per task
```

Use the superpowers:finishing-a-development-branch skill to close out (merge/PR per operator preference). Do NOT deploy to the production container from this plan — the operator handles build/deploy (garage/kiosk reload rules apply on kckern-server; see CLAUDE.local.md).
