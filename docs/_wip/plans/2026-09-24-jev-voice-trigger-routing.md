# Voice Trigger Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a spoken transcript (from HA Assist, a phone shortcut, anything that already has text) fire one of a location's configured trigger commands, trying the exact keyword first and falling back to a Jev `choice` over the location's commands plus `none`, with a confirm step until the model has earned direct routing.
**Architecture:** A new `voice` modality in the trigger registry (sources.yml parser → `VoiceResolver` in the pure domain, registered in `ResolverRegistry`) makes `GET /trigger/<loc>/voice/<command>` work like `state`. A new application service `VoiceTriggerService` owns `POST /trigger/<loc>/voice {transcript}`: auth, then `VoiceCommandMatcher` (exact keyword, else one Jev `choice` with a 1.5 s timeout and a confidence floor), then either a stored proposal the caller must confirm (`confirm` mode, the default) or a dispatch through the unchanged `TriggerDispatchService.handleTrigger(loc, 'voice', command)` (`route` mode, or any exact match).
**Tech Stack:** Node ESM backend, Express router, `IDecisionGateway` (`choice` builder, JevAdapter), vitest + supertest.

---

## Current state (verified)

- **There is no voice modality today, not even exact-keyword.** `ResolverRegistry.resolvers` has only `nfc`, `state`, `barcode` (`backend/src/2_domains/trigger/services/ResolverRegistry.mjs:34-38`). `parseSources` throws `UNKNOWN_MODALITY` for any `modality:` other than nfc/state/barcode (`backend/src/1_adapters/trigger/parsers/sourcesParser.mjs:44-54`), so a `voice` source in sources.yml would take down the *whole* trigger registry at boot (`triggerApi.mjs:81-88` falls back to empty). `buildTriggerRegistry` emits no `voice` slice (`parsers/buildTriggerRegistry.mjs:16-27`), so `GET /api/v1/trigger/kitchen/voice/play_jazz` today returns 400 `UNKNOWN_MODALITY` (`TriggerDispatchService.mjs:170-174`; there is even a test pinning exactly that: `tests/isolated/application/trigger/TriggerDispatchService.test.mjs:208-212`).
- **The docs describe a voice path that does not exist.** `docs/reference/trigger/events.md:191-193` says voice needs "no code changes in the trigger domain"; `docs/reference/trigger-endpoint.md:3,16` lists `voice` as a reader type. Both are aspirational. The same docs also point at stale paths: per-modality dirs `triggers/<modality>/locations.yml` (code reads one `triggers/sources.yml`, `YamlTriggerConfigRepository.mjs:44-51`), `actionHandlers.mjs` (does not exist; it is `responseHandlers.mjs`), and "createTriggerApiRouter in bootstrap.mjs" (it is `5_composition/modules/triggerApi.mjs`).
- **The closest existing shape is `state`:** per-location map value → `{action, ...}` resolved by `StateResolver` (`StateResolver.mjs:36-69`), then `mapIntentToResponse` (`3_applications/trigger/mapIntentToResponse.mjs:28-80`) handles `play|queue|play-next|open|clear|scene|ha-service|script`. Voice reuses that intent shape exactly.
- **Dispatch pipeline to reuse unchanged:** `TriggerDispatchService.handleTrigger(location, modality, value, {token, dryRun})` (`TriggerDispatchService.mjs:332-334`) does modality/location checks, `authenticate` (`guards/authenticate.mjs:6-11`), a 30 s per-(location, modality, value) debounce (`:199-210`), resolve, map, dispatch, and the `trigger:<location>:<modality>` WS broadcast (`:336-341`). Voice gets all of that by calling it with the matched command id as `value`.
- **HTTP surface:** only `GET /:location/:type/:value`, `PUT .../note`, `POST /side-effect` (`backend/src/4_api/v1/routers/trigger.mjs:37-91`). No body-carrying trigger ingress exists.
- **No speech-to-text feeds triggers.** Whisper-style transcription exists for journalist/nutribot voice notes and fitness voice memos (composition modules), but nothing hands a transcript to the trigger system. **STT is out of scope for this plan**; the slice accepts text.
- **Wiring:** `decisionGateway` is built in `createApp` at `backend/src/app.mjs:711-717` (null without a Jev key); `createTriggerApiRouter({...})` is called at `app.mjs:5398-5420` inside the same function and does not receive it today. `triggerApi.mjs:46-135` builds the dispatch service and router.
- **Live config:** the household `triggers/sources.yml` has four sources (two nfc, one state, one barcode) and no voice source.
- **Test layout:** existing trigger tests live under `tests/isolated/{adapter,domain,application,api}/trigger/`, not colocated. Per the brief, new modules get colocated `*.test.mjs`; three existing isolated tests that pin the exact empty-registry shape get a `voice` key added (Task 1).

## Questions for Jev

One question per transcript, only when the exact keyword misses and the location's `routing.mode` is not `off`:

```js
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const INSTRUCTIONS = 'Someone in the house said `said`. Which listed command were they asking for? '
  + 'Choose "none" if they asked for something not listed, were not giving a command, '
  + 'or the words could mean more than one listed command.';

// options = every configured command id → its `description` (null when absent),
// plus the reserved 'none' option. Command ids are keyword-normalized
// (lowercase, non-alphanumerics → '_'); the parser forbids a command called 'none'.
const question = {
  command: choice(INSTRUCTIONS, {
    play_jazz: 'Play jazz music on the kitchen display',
    lights_off: 'Turn the kitchen lights off',
    none: 'None of these: not a request for any listed command',
  }),
};

// state — deliberately just the words. No location or device ids: they are
// not evidence about intent and would bias toward commands whose ids echo them.
const state = { said: 'could you put some jazz on' };

await decisionGateway.evaluate(state, question, { timeout: 1500 });
// → answers.command = { type: 'choice', choice: 'play_jazz', confidence: 0.83, probabilities: {...} }
```

Acceptance: `choice !== 'none'`, `choice` is a configured id, and `confidence >= floor` (per-location `routing.confidence_floor`, default **0.6**). Below the floor → treated as `none`, logged as `trigger.voice.near_miss`. Timeout **1500 ms** (Jev is ~70-500 ms; the caller is a person waiting). Any throw → `trigger.voice.decision_failed`, treated as no match. English transcripts expected; Jev is weaker on CJK.

## Rollout

Voice routing is a **new capability** (nothing decides today), so per policy it ships **gated behind confirm**, never silent apply:

| `routing.mode` (per voice source) | Exact keyword | Jev match above floor |
|---|---|---|
| `off` | dispatches | not asked |
| `confirm` (**default**) | dispatches | returns a proposal; caller must `POST .../voice/confirm {proposal}` within 120 s to dispatch |
| `route` | dispatches | dispatches directly |

Exact keyword always dispatches: that is the documented `/voice/<keyword>` contract and involves no model judgement.

**Promotion `confirm` → `route` for a location**, measured in the log store over ≥ 14 days:

- Proposals: `"trigger.voice.proposed" AND data.location:<loc>`; confirmations: `"trigger.voice.confirmed" AND data.location:<loc>` (both carry `proposalId`, `command`, `confidence`).
- Promote when there are **≥ 30 proposals** and **≥ 90 % were confirmed**, and no single command has a confirm rate below 80 % (`| stats by ("data.command") count()` on each event).
- Tune the floor from `trigger.voice.near_miss` (would-be commands under the floor) and `trigger.voice.match` with `reason:none`. If near-misses cluster just under the floor on commands that are confirmed at ≥ 95 % above it, lower the floor by 0.05 in config; never below 0.4.
- Promotion is a one-line `routing.mode: route` edit on the source in `triggers/sources.yml` plus a config reload. No code change.

## Config shape (sources.yml)

```yaml
kitchen-voice:
  modality: voice
  location: kitchen
  target: kitchen-display
  guards:
    authenticate:
      secret: <token>          # optional; same guard as nfc/state
  routing:
    mode: confirm              # off | confirm | route  (default confirm)
    confidence_floor: 0.6      # optional; default 0.6
  commands:
    play_jazz:
      description: Play jazz music on the kitchen display
      action: play
      content: plex:12345
    lights_off:
      description: Turn the kitchen lights off
      action: scene
      scene: scene.kitchen_off
```

Parsed slice: `registry.voice.locations[location] = { target, auth_token, routing: { mode, confidenceFloor }, commands: { [keyword]: entry } }`.

---

## Task 0: Worktree and baseline

**Step 1: Create the worktree**

```bash
cd /path/to/DaylightStation   # repo root
git fetch origin
git worktree add .worktrees/voice-trigger-routing -b feat/voice-trigger-routing main
cd .worktrees/voice-trigger-routing
```

**Step 2: Baseline the touched test dirs**

```bash
npx vitest run tests/isolated/adapter/trigger tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/api/routers/trigger.test.mjs
```

Expected: all pass. Record the count. Do not start a backend.

---

## Task 1: Parse `modality: voice` sources

> **Updated 2026-09-24, after this plan was written:** the boot-time hazard this
> task guarded against is already fixed on main (`04872101a`, "one bad source or
> tag no longer empties the whole registry"). `sourcesParser.mjs` now has an
> `onSkip` option, an exported `isolateEntry`, a modality allowlist
> (`['nfc', 'state', 'barcode']`) and a `perLocation` helper, so the line ranges
> below are stale. Add `'voice'` to the allowlist, route voice entries through
> `perLocation` with `parseVoiceLocations`, and keep `onSkip` threaded through
> `buildTriggerRegistry`. Today an unknown `voice` source is skipped and logged as
> `trigger.config.entry.skipped`; it no longer empties the registry. The three
> "expectations only" test edits may no longer be needed; re-check them against main.

**Files:**
- Create: `backend/src/1_adapters/trigger/parsers/voiceLocationsParser.mjs`
- Create: `backend/src/1_adapters/trigger/parsers/voiceLocationsParser.test.mjs`
- Modify: `backend/src/1_adapters/trigger/parsers/sourcesParser.mjs:14-15, 31-66`
- Modify: `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs:17-26`
- Modify (expectations only): `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs:7`, `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs:25`, `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs:33-39`

The parser needs `voiceKeyword` from the domain; Task 2 creates it. To keep this task self-contained, create the domain file's `voiceKeyword` export here (Task 2 adds the class to the same file).

**Step 1: Write the failing test**

`backend/src/1_adapters/trigger/parsers/voiceLocationsParser.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { parseVoiceLocations } from './voiceLocationsParser.mjs';
import { parseSources } from './sourcesParser.mjs';
import { buildTriggerRegistry } from './buildTriggerRegistry.mjs';

const kitchen = {
  target: 'kitchen-display',
  commands: {
    'Play Jazz': { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { action: 'scene', scene: 'scene.kitchen_off' },
  },
};

describe('parseVoiceLocations', () => {
  it('returns {} for missing input', () => {
    expect(parseVoiceLocations(null)).toEqual({});
  });

  it('normalizes command ids to keywords and defaults routing to confirm', () => {
    const out = parseVoiceLocations({ kitchen });
    expect(out.kitchen).toEqual({
      target: 'kitchen-display',
      auth_token: null,
      routing: { mode: 'confirm', confidenceFloor: null },
      commands: {
        play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
        lights_off: { action: 'scene', scene: 'scene.kitchen_off' },
      },
    });
  });

  it('carries routing mode, floor and auth token', () => {
    const out = parseVoiceLocations({ kitchen: { ...kitchen, auth_token: 's', routing: { mode: 'route', confidence_floor: 0.7 } } });
    expect(out.kitchen.auth_token).toBe('s');
    expect(out.kitchen.routing).toEqual({ mode: 'route', confidenceFloor: 0.7 });
  });

  it.each([
    ['no target', { commands: kitchen.commands }, 'MISSING_TARGET'],
    ['no commands', { target: 't' }, 'MISSING_COMMANDS'],
    ['empty commands', { target: 't', commands: {} }, 'MISSING_COMMANDS'],
    ['command without action', { target: 't', commands: { a: { description: 'x' } } }, 'COMMAND_MISSING_ACTION'],
    ['reserved none id', { target: 't', commands: { None: { action: 'clear' } } }, 'INVALID_COMMAND_ID'],
    ['ids that collide after normalizing', { target: 't', commands: { 'a b': { action: 'clear' }, a_b: { action: 'clear' } } }, 'DUPLICATE_COMMAND'],
    ['bad mode', { ...kitchen, routing: { mode: 'yolo' } }, 'INVALID_ROUTING_MODE'],
    ['floor out of range', { ...kitchen, routing: { confidence_floor: 1.5 } }, 'INVALID_CONFIDENCE_FLOOR'],
  ])('rejects %s', (_label, entry, code) => {
    expect(() => parseVoiceLocations({ kitchen: entry })).toThrow(expect.objectContaining({ code }));
  });
});

describe('voice sources in sources.yml', () => {
  it('parseSources partitions a voice source by its location and lifts the auth secret', () => {
    const out = parseSources({
      'kitchen-voice': { modality: 'voice', location: 'kitchen', guards: { authenticate: { secret: 's' } }, ...kitchen },
    });
    expect(out.voice.locations.kitchen.auth_token).toBe('s');
    expect(Object.keys(out.voice.locations.kitchen.commands)).toEqual(['play_jazz', 'lights_off']);
  });

  it('parseSources returns an empty voice slice when there is no sources file', () => {
    expect(parseSources(null).voice).toEqual({ locations: {} });
  });

  it('buildTriggerRegistry exposes registry.voice', () => {
    const reg = buildTriggerRegistry({ sources: { kitchen: { modality: 'voice', ...kitchen } } });
    expect(reg.voice.locations.kitchen.target).toBe('kitchen-display');
  });
});
```

**Step 2: Run it**

```bash
npx vitest run backend/src/1_adapters/trigger/parsers/voiceLocationsParser.test.mjs
```

Expected: FAIL, `Failed to resolve import "./voiceLocationsParser.mjs"`.

**Step 3: Implement**

Create `backend/src/2_domains/trigger/services/VoiceResolver.mjs` (keyword only for now; Task 2 extends it):

```js
/**
 * Voice resolver: maps a spoken keyword (or a transcript that normalizes to
 * one) at a location to that location's configured command intent.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Pure. The decision
 * model that maps free text to a command lives in the application layer
 * (VoiceCommandMatcher); this file only knows exact keywords.
 *
 * @module domains/trigger/services/VoiceResolver
 */

/**
 * Keyword form of a command id or a transcript: lowercase, every run of
 * non-letters/digits collapsed to '_', trimmed of '_'. "Play Jazz!" → "play_jazz".
 * @param {string} value
 * @returns {string}
 */
export function voiceKeyword(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
}
```

`backend/src/1_adapters/trigger/parsers/voiceLocationsParser.mjs`:

```js
/**
 * Parser for voice sources (sources.yml entries with `modality: voice`).
 *
 * Output shape:
 *   { [locationId]: { target, auth_token, routing: { mode, confidenceFloor }, commands: { [keyword]: entry } } }
 *
 * Command ids are normalized with voiceKeyword so `/voice/Play_Jazz`, the
 * transcript "play jazz" and the YAML key `play jazz` all meet at `play_jazz`.
 * `none` is reserved: it is the decision model's "no command" option.
 *
 * Layer: ADAPTER (1_adapters/trigger/parsers).
 * @module adapters/trigger/parsers/voiceLocationsParser
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { voiceKeyword } from '#domains/trigger/services/VoiceResolver.mjs';

const ROUTING_MODES = new Set(['off', 'confirm', 'route']);
const RESERVED_COMMAND_IDS = new Set(['none']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseRouting(locationId, raw) {
  const routing = isPlainObject(raw) ? raw : {};
  const mode = routing.mode ?? 'confirm';
  if (!ROUTING_MODES.has(mode)) {
    throw new ValidationError(`voice location "${locationId}" routing.mode must be off|confirm|route`, { code: 'INVALID_ROUTING_MODE', field: locationId });
  }
  const floor = routing.confidence_floor ?? null;
  if (floor !== null && !(typeof floor === 'number' && floor >= 0 && floor <= 1)) {
    throw new ValidationError(`voice location "${locationId}" routing.confidence_floor must be a number 0..1`, { code: 'INVALID_CONFIDENCE_FLOOR', field: locationId });
  }
  return { mode, confidenceFloor: floor };
}

export function parseVoiceLocations(raw) {
  if (!raw) return {};
  if (!isPlainObject(raw)) {
    throw new ValidationError('voice sources must be an object', { code: 'INVALID_CONFIG_ROOT' });
  }
  const out = {};
  for (const [locationId, loc] of Object.entries(raw)) {
    if (!isPlainObject(loc)) {
      throw new ValidationError(`voice location "${locationId}" must be an object`, { code: 'INVALID_LOCATION', field: locationId });
    }
    if (typeof loc.target !== 'string' || loc.target.length === 0) {
      throw new ValidationError(`voice location "${locationId}" must declare a target device (non-empty string)`, { code: 'MISSING_TARGET', field: locationId });
    }
    if (!isPlainObject(loc.commands) || Object.keys(loc.commands).length === 0) {
      throw new ValidationError(`voice location "${locationId}" needs at least one command`, { code: 'MISSING_COMMANDS', field: locationId });
    }
    const commands = {};
    for (const [rawId, entry] of Object.entries(loc.commands)) {
      const id = voiceKeyword(rawId);
      if (!id || RESERVED_COMMAND_IDS.has(id)) {
        throw new ValidationError(`voice command "${rawId}" at "${locationId}" has a reserved or empty id`, { code: 'INVALID_COMMAND_ID', field: rawId });
      }
      if (!isPlainObject(entry) || typeof entry.action !== 'string' || entry.action.length === 0) {
        throw new ValidationError(`voice command "${rawId}" at "${locationId}" has no action`, { code: 'COMMAND_MISSING_ACTION', field: rawId });
      }
      if (commands[id]) {
        throw new ValidationError(`voice commands at "${locationId}" collide on "${id}"`, { code: 'DUPLICATE_COMMAND', field: rawId });
      }
      commands[id] = entry;
    }
    out[locationId] = {
      target: loc.target,
      auth_token: loc.auth_token ?? null,
      routing: parseRouting(locationId, loc.routing),
      commands,
    };
  }
  return out;
}

export default parseVoiceLocations;
```

`sourcesParser.mjs`: add the import after line 15, a `voiceRaw` bucket, the branch, and the slice in both returns.

```js
import { parseVoiceLocations } from './voiceLocationsParser.mjs';
```

```js
export function parseSources(raw) {
  if (!raw) return { nfc: { locations: {} }, state: { locations: {} }, barcode: { locations: {} }, voice: { locations: {} } };
  // ... unchanged root check ...
  const nfcRaw = {};
  const stateRaw = {};
  const barcodeRaw = {};
  const voiceRaw = {};
  for (const [sourceId, entry] of Object.entries(raw)) {
    // ... unchanged object check + location ...
    if (entry.modality === 'nfc') nfcRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'state') stateRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'voice') voiceRaw[location] = toLegacyEntry(entry);
    else if (entry.modality === 'barcode') {
      // ... unchanged ...
    }
    else throw new ValidationError(/* unchanged */);
  }
  // ... unchanged nfc debounce lift ...
  return {
    nfc: { locations: nfcLocations },
    state: { locations: parseStateLocations(stateRaw) },
    barcode: { locations: barcodeRaw },
    voice: { locations: parseVoiceLocations(voiceRaw) },
  };
}
```

`buildTriggerRegistry.mjs`:

```js
  const { nfc, state, barcode, voice } = parseSources(blobs.sources);
  // ...
  return {
    nfc: { locations: nfc.locations, tags },
    state: { locations: state.locations },
    barcode: { locations: barcode.locations },
    voice: { locations: voice.locations },
    responses: parseNamedMap(blobs.responses, 'responses'),
    endpoints: parseNamedMap(blobs.endpoints, 'endpoints'),
  };
```

Update the three empty-shape expectations to include `voice: { locations: {} }` after `barcode: { locations: {} }`:
- `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.test.mjs:7`
- `tests/isolated/adapter/trigger/parsers/buildTriggerRegistry.v2.test.mjs:25`
- `tests/isolated/adapter/trigger/YamlTriggerConfigRepository.test.mjs:33-39`

**Step 4: Run**

```bash
npx vitest run backend/src/1_adapters/trigger/parsers/voiceLocationsParser.test.mjs tests/isolated/adapter/trigger
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/1_adapters/trigger/parsers/voiceLocationsParser.mjs backend/src/1_adapters/trigger/parsers/voiceLocationsParser.test.mjs backend/src/1_adapters/trigger/parsers/sourcesParser.mjs backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs backend/src/2_domains/trigger/services/VoiceResolver.mjs tests/isolated/adapter/trigger
git commit -m "$(cat <<'EOF'
feat(trigger): parse modality: voice sources into a registry slice

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `VoiceResolver` and exact-keyword dispatch

**Files:**
- Modify: `backend/src/2_domains/trigger/services/VoiceResolver.mjs` (add class)
- Create: `backend/src/2_domains/trigger/services/VoiceResolver.test.mjs`
- Modify: `backend/src/2_domains/trigger/services/ResolverRegistry.mjs:22-38`

**Step 1: Write the failing test**

`backend/src/2_domains/trigger/services/VoiceResolver.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { VoiceResolver, voiceKeyword } from './VoiceResolver.mjs';
import { ResolverRegistry } from './ResolverRegistry.mjs';

const kitchen = {
  target: 'kitchen-display',
  auth_token: null,
  routing: { mode: 'confirm', confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1', volume: 10 },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.kitchen_off', target: 'other' },
    stop: { action: 'clear' },
  },
};
const registry = { locations: { kitchen } };

describe('voiceKeyword', () => {
  it.each([
    ['Play Jazz!', 'play_jazz'],
    ['  play   jazz ', 'play_jazz'],
    ['play_jazz', 'play_jazz'],
    ['재즈 틀어', '재즈_틀어'],
    ['', ''],
    [null, ''],
  ])('%j → %j', (input, expected) => {
    expect(voiceKeyword(input)).toBe(expected);
  });
});

describe('VoiceResolver.resolve', () => {
  it('returns null for an unknown location or keyword', () => {
    expect(VoiceResolver.resolve({ location: 'attic', value: 'play_jazz', registry })).toBeNull();
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'make coffee', registry })).toBeNull();
  });

  it('resolves a transcript that normalizes to a command id, with params and content', () => {
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'Play jazz', registry })).toEqual({
      action: 'play', target: 'kitchen-display', content: 'plex:1', params: { volume: 10 },
    });
  });

  it('lets a command override the location target and keeps description out of params', () => {
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'lights_off', registry })).toEqual({
      action: 'scene', target: 'other', scene: 'scene.kitchen_off', params: {},
    });
  });
});

describe('VoiceResolver.commandOptions', () => {
  it('maps command ids to descriptions, null when absent', () => {
    expect(VoiceResolver.commandOptions(kitchen)).toEqual({
      play_jazz: 'Play jazz music', lights_off: 'Kitchen lights off', stop: null,
    });
  });

  it('returns {} for a missing location config', () => {
    expect(VoiceResolver.commandOptions(undefined)).toEqual({});
  });
});

describe('ResolverRegistry voice', () => {
  it('dispatches voice to VoiceResolver with the voice slice', () => {
    const intent = ResolverRegistry.resolve({ modality: 'voice', location: 'kitchen', value: 'stop', registry: { voice: registry } });
    expect(intent).toEqual({ action: 'clear', target: 'kitchen-display', params: {} });
  });
});
```

**Step 2: Run**

```bash
npx vitest run backend/src/2_domains/trigger/services/VoiceResolver.test.mjs
```

Expected: FAIL, `VoiceResolver` is not exported (and `UnknownModalityError: Unknown trigger modality: voice`).

**Step 3: Implement**

Append to `VoiceResolver.mjs`:

```js
const RESERVED_KEYS = new Set(['action', 'target', 'content', 'scene', 'service', 'entity', 'data', 'description']);
const PASSTHROUGH_KEYS = ['content', 'scene', 'service', 'entity', 'data'];

/**
 * @class VoiceResolver
 * @stateless
 */
export class VoiceResolver {
  /**
   * @param {Object} args
   * @param {string} args.location
   * @param {string} args.value     keyword or transcript
   * @param {Object} args.registry  the `voice` slice: { locations }
   * @returns {Object|null} intent (same shape as StateResolver) or null
   */
  static resolve({ location, value, registry }) {
    const locationConfig = registry?.locations?.[location];
    if (!locationConfig) return null;
    return VoiceResolver.intentFor(locationConfig, voiceKeyword(value));
  }

  /**
   * Intent for one command id at a location.
   * @param {Object} locationConfig  one entry of registry.voice.locations
   * @param {string} commandId       keyword-normalized id
   * @returns {Object|null}
   */
  static intentFor(locationConfig, commandId) {
    const entry = locationConfig?.commands?.[commandId];
    if (!entry) return null;
    const params = {};
    for (const [k, v] of Object.entries(entry)) {
      if (!RESERVED_KEYS.has(k)) params[k] = v;
    }
    const intent = { action: entry.action, target: entry.target ?? locationConfig.target, params };
    for (const key of PASSTHROUGH_KEYS) {
      if (entry[key] !== undefined) intent[key] = entry[key];
    }
    return intent;
  }

  /**
   * The location's commands as choice options: id → description (null = self-explanatory id).
   * @param {Object} locationConfig
   * @returns {Object<string, string|null>}
   */
  static commandOptions(locationConfig) {
    const out = {};
    for (const [id, entry] of Object.entries(locationConfig?.commands || {})) {
      out[id] = typeof entry?.description === 'string' && entry.description.trim() ? entry.description.trim() : null;
    }
    return out;
  }
}

export default VoiceResolver;
```

`ResolverRegistry.mjs`: add the import and map entry.

```js
import { VoiceResolver } from './VoiceResolver.mjs';
// ...
export const resolvers = {
  nfc: NfcResolver,
  state: StateResolver,
  barcode: BarcodeResolver,
  voice: VoiceResolver,
};
```

**Step 4: Run**

```bash
npx vitest run backend/src/2_domains/trigger/services/VoiceResolver.test.mjs tests/isolated/domain/trigger && npm run audit:layers
```

Expected: PASS; layer audit clean (VoiceResolver imports nothing outside the domain).

**Step 5: Commit**

```bash
git add backend/src/2_domains/trigger/services/VoiceResolver.mjs backend/src/2_domains/trigger/services/VoiceResolver.test.mjs backend/src/2_domains/trigger/services/ResolverRegistry.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): VoiceResolver — exact voice keywords resolve like state values

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `VoiceCommandMatcher` (exact first, then one Jev choice)

**Files:**
- Create: `backend/src/3_applications/trigger/VoiceCommandMatcher.mjs`
- Create: `backend/src/3_applications/trigger/VoiceCommandMatcher.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { VoiceCommandMatcher } from './VoiceCommandMatcher.mjs';

const kitchen = {
  target: 'kitchen-display',
  routing: { mode: 'confirm', confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.k' },
  },
};

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const gatewayAnswering = (choice, confidence) => ({
  isConfigured: () => true,
  evaluate: vi.fn(async () => ({ model: 'jev-test', answers: { command: { type: 'choice', choice, confidence, probabilities: {} } }, usage: {} })),
});

describe('VoiceCommandMatcher', () => {
  it('an exact keyword wins without calling the model', async () => {
    const gw = gatewayAnswering('lights_off', 0.99);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    expect(await m.match({ location: 'kitchen', transcript: 'Play jazz', locationConfig: kitchen }))
      .toMatchObject({ command: 'play_jazz', via: 'exact', reason: null });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });

  it('asks one choice over the commands plus none, with the transcript as state and a tight timeout', async () => {
    const gw = gatewayAnswering('play_jazz', 0.83);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    const out = await m.match({ location: 'kitchen', transcript: 'put some jazz on', locationConfig: kitchen });
    expect(out).toMatchObject({ command: 'play_jazz', via: 'jev', confidence: 0.83, reason: null });
    const [state, questions, options] = gw.evaluate.mock.calls[0];
    expect(state).toEqual({ said: 'put some jazz on' });
    expect(questions.command.type).toBe('choice');
    expect(Object.keys(questions.command.options)).toEqual(['play_jazz', 'lights_off', 'none']);
    expect(questions.command.options.play_jazz).toBe('Play jazz music');
    expect(options).toEqual({ timeout: 1500 });
  });

  it('below the floor is no match, logged as a near miss', async () => {
    const log = logger();
    const m = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('play_jazz', 0.4), logger: log });
    const out = await m.match({ location: 'kitchen', transcript: 'music maybe', locationConfig: kitchen });
    expect(out).toMatchObject({ command: null, reason: 'low-confidence', jevCommand: 'play_jazz' });
    expect(log.info).toHaveBeenCalledWith('trigger.voice.near_miss', expect.objectContaining({ location: 'kitchen', jevCommand: 'play_jazz', confidence: 0.4, floor: 0.6 }));
  });

  it('the per-location floor overrides the default', async () => {
    const m = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('play_jazz', 0.55), logger: logger() });
    const cfg = { ...kitchen, routing: { mode: 'confirm', confidenceFloor: 0.5 } };
    expect((await m.match({ location: 'kitchen', transcript: 'jazz?', locationConfig: cfg })).command).toBe('play_jazz');
  });

  it('none and out-of-set answers are no match', async () => {
    const none = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('none', 0.95), logger: logger() });
    expect(await none.match({ location: 'kitchen', transcript: 'what time is it', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'none' });
    const odd = new VoiceCommandMatcher({ decisionGateway: gatewayAnswering('toString', 0.95), logger: logger() });
    expect(await odd.match({ location: 'kitchen', transcript: 'x', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'outside-options' });
  });

  it('a failing or absent model is no match and never throws', async () => {
    const log = logger();
    const failing = { isConfigured: () => true, evaluate: vi.fn(async () => { throw new Error('timeout of 1500ms exceeded'); }) };
    const m = new VoiceCommandMatcher({ decisionGateway: failing, logger: log });
    expect(await m.match({ location: 'kitchen', transcript: 'jazz', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'decision-failed' });
    expect(log.warn).toHaveBeenCalledWith('trigger.voice.decision_failed', expect.objectContaining({ location: 'kitchen' }));

    const noop = new VoiceCommandMatcher({ decisionGateway: { isConfigured: () => false, evaluate: vi.fn() }, logger: logger() });
    expect(await noop.match({ location: 'kitchen', transcript: 'jazz', locationConfig: kitchen })).toMatchObject({ command: null, reason: 'no-decision-model' });
  });

  it('useModel:false skips the model', async () => {
    const gw = gatewayAnswering('play_jazz', 0.99);
    const m = new VoiceCommandMatcher({ decisionGateway: gw, logger: logger() });
    expect(await m.match({ location: 'kitchen', transcript: 'jazz please', locationConfig: kitchen, useModel: false }))
      .toMatchObject({ command: null, reason: 'model-off' });
    expect(gw.evaluate).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run**

```bash
npx vitest run backend/src/3_applications/trigger/VoiceCommandMatcher.test.mjs
```

Expected: FAIL, cannot resolve `./VoiceCommandMatcher.mjs`.

**Step 3: Implement**

```js
/**
 * VoiceCommandMatcher — which of a location's configured voice commands does
 * a transcript ask for?
 *
 *   1. exact keyword ("play jazz" → play_jazz): no model, always trusted;
 *   2. otherwise one typed-decision `choice` over the command ids (their
 *      descriptions as option text) plus 'none'. Accepted only at or above
 *      the confidence floor; below it the answer is logged as a near miss
 *      and treated as no match.
 *
 * Never throws: a missing or failing decision model is "no match".
 * Layer: APPLICATION (3_applications/trigger). Owns the question.
 */
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';
import { VoiceResolver, voiceKeyword } from '#domains/trigger/services/VoiceResolver.mjs';

const NONE = 'none';
const DEFAULT_CONFIDENCE_FLOOR = 0.6;
const DEFAULT_TIMEOUT_MS = 1500;
const LOG_TRANSCRIPT_CHARS = 200;

const INSTRUCTIONS = 'Someone in the house said `said`. Which listed command were they asking for? '
  + 'Choose "none" if they asked for something not listed, were not giving a command, '
  + 'or the words could mean more than one listed command.';
const NONE_DESCRIPTION = 'None of these: not a request for any listed command';

const miss = (reason, extra = {}) => ({ command: null, via: null, confidence: null, reason, ...extra });

export class VoiceCommandMatcher {
  #decisionGateway; #confidenceFloor; #timeoutMs; #clock; #logger;

  /**
   * @param {Object} deps
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {number} [deps.confidenceFloor=0.6] - default floor; a location's routing.confidenceFloor overrides it
   * @param {number} [deps.timeoutMs=1500]
   * @param {Function} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, confidenceFloor = DEFAULT_CONFIDENCE_FLOOR, timeoutMs = DEFAULT_TIMEOUT_MS, clock = () => Date.now(), logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#confidenceFloor = confidenceFloor;
    this.#timeoutMs = timeoutMs;
    this.#clock = clock;
    this.#logger = logger;
  }

  get hasDecisionModel() { return !!this.#decisionGateway; }

  /**
   * @param {Object} params
   * @param {string} params.location
   * @param {string} params.transcript
   * @param {Object} params.locationConfig - registry.voice.locations[location]
   * @param {boolean} [params.useModel=true] - false = exact keyword only
   * @returns {Promise<{ command: string|null, via: 'exact'|'jev'|null, confidence: number|null, reason: string|null, jevCommand?: string|null, model?: string|null }>}
   */
  async match({ location, transcript, locationConfig, useModel = true }) {
    const keyword = voiceKeyword(transcript);
    if (keyword && locationConfig?.commands?.[keyword]) {
      this.#logger.debug?.('trigger.voice.match', { location, command: keyword, via: 'exact' });
      return { command: keyword, via: 'exact', confidence: null, reason: null };
    }
    if (!useModel) return miss('model-off');
    if (!this.#decisionGateway) return miss('no-decision-model');

    const commands = VoiceResolver.commandOptions(locationConfig);
    if (Object.keys(commands).length === 0) return miss('no-commands');
    const options = { ...commands, [NONE]: NONE_DESCRIPTION };
    const floor = locationConfig?.routing?.confidenceFloor ?? this.#confidenceFloor;
    const startedAt = this.#clock();

    let result;
    try {
      result = await this.#decisionGateway.evaluate(
        { said: transcript },
        { command: choice(INSTRUCTIONS, options) },
        { timeout: this.#timeoutMs },
      );
    } catch (error) {
      this.#logger.warn?.('trigger.voice.decision_failed', { location, error: error.message, elapsedMs: this.#clock() - startedAt });
      return miss('decision-failed');
    }

    const answer = result?.answers?.command ?? {};
    const picked = typeof answer.choice === 'string' ? answer.choice : null;
    const confidence = Number.isFinite(answer.confidence) ? answer.confidence : null;
    const reason = !picked || !Object.hasOwn(options, picked) ? 'outside-options'
      : picked === NONE ? 'none'
      : confidence === null || confidence < floor ? 'low-confidence'
      : null;
    const logData = {
      location,
      transcript: String(transcript).slice(0, LOG_TRANSCRIPT_CHARS),
      jevCommand: picked,
      confidence,
      floor,
      reason,
      model: result?.model ?? null,
      elapsedMs: this.#clock() - startedAt,
    };

    if (reason === 'low-confidence') {
      this.#logger.info?.('trigger.voice.near_miss', logData);
    } else {
      this.#logger.info?.('trigger.voice.match', { ...logData, command: reason ? null : picked, via: reason ? null : 'jev' });
    }
    if (reason) return miss(reason, { confidence, jevCommand: picked });
    return { command: picked, via: 'jev', confidence, reason: null, model: result?.model ?? null };
  }
}

export default VoiceCommandMatcher;
```

**Step 4: Run**

```bash
npx vitest run backend/src/3_applications/trigger/VoiceCommandMatcher.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/VoiceCommandMatcher.mjs backend/src/3_applications/trigger/VoiceCommandMatcher.test.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): VoiceCommandMatcher — exact keyword, else Jev choice over commands + none

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `VoiceTriggerService` (auth, modes, proposals, dispatch)

**Files:**
- Create: `backend/src/3_applications/trigger/VoiceTriggerService.mjs`
- Create: `backend/src/3_applications/trigger/VoiceTriggerService.test.mjs`

**Step 1: Write the failing test**

The last test runs a real `TriggerDispatchService` so the voice slice is proven end to end through resolve → map → dispatch → broadcast.

```js
import { describe, it, expect, vi } from 'vitest';
import { VoiceTriggerService } from './VoiceTriggerService.mjs';
import { TriggerDispatchService } from './TriggerDispatchService.mjs';

const kitchen = (mode = 'confirm', auth_token = null) => ({
  target: 'kitchen-display',
  auth_token,
  routing: { mode, confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.kitchen_off' },
  },
});
const configWith = (loc) => ({ voice: { locations: { kitchen: loc } } });
const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const matcherReturning = (m) => ({ match: vi.fn(async () => m) });
const dispatcher = () => ({ handleTrigger: vi.fn(async (location, modality, value) => ({ ok: true, location, modality, value, action: 'play' })) });

function make({ loc = kitchen(), match = { command: 'play_jazz', via: 'jev', confidence: 0.8, reason: null }, now = { t: 1000 } } = {}) {
  const triggerDispatchService = dispatcher();
  const matcher = matcherReturning(match);
  const logger = silent();
  let n = 0;
  const service = new VoiceTriggerService({
    config: configWith(loc), matcher, triggerDispatchService, logger,
    createProposalId: () => `p${++n}`, clock: () => now.t,
  });
  return { service, matcher, triggerDispatchService, logger, now };
}

describe('VoiceTriggerService.handleTranscript', () => {
  it('rejects empty and oversized transcripts before anything else', async () => {
    const { service, matcher } = make();
    expect((await service.handleTranscript('kitchen', '   ')).code).toBe('INVALID_TRANSCRIPT');
    expect((await service.handleTranscript('kitchen', 'x'.repeat(501))).code).toBe('INVALID_TRANSCRIPT');
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it('unknown location and bad token never reach the model', async () => {
    const { service, matcher } = make({ loc: kitchen('confirm', 'secret') });
    expect((await service.handleTranscript('attic', 'jazz')).code).toBe('LOCATION_NOT_FOUND');
    expect((await service.handleTranscript('kitchen', 'jazz', { token: 'nope' })).code).toBe('AUTH_FAILED');
    expect(matcher.match).not.toHaveBeenCalled();
  });

  it('an exact match dispatches in every mode, through handleTrigger', async () => {
    const { service, triggerDispatchService } = make({ match: { command: 'play_jazz', via: 'exact', confidence: null, reason: null } });
    const out = await service.handleTranscript('kitchen', 'play jazz', { token: 't' });
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: 't', dryRun: undefined });
    expect(out).toMatchObject({ ok: true, voice: { transcript: 'play jazz', command: 'play_jazz', via: 'exact' } });
  });

  it('confirm mode turns a model match into a proposal and dispatches nothing', async () => {
    const { service, triggerDispatchService, logger } = make();
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(triggerDispatchService.handleTrigger).not.toHaveBeenCalled();
    expect(out).toEqual({
      ok: true, confirm: true, location: 'kitchen',
      proposal: { id: 'p1', command: 'play_jazz', description: 'Play jazz music', confidence: 0.8, expiresInMs: 120000 },
    });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.proposed', expect.objectContaining({ proposalId: 'p1', location: 'kitchen', command: 'play_jazz', confidence: 0.8 }));
  });

  it('route mode dispatches a model match directly', async () => {
    const { service, triggerDispatchService } = make({ loc: kitchen('route') });
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: undefined, dryRun: undefined });
    expect(out.voice).toEqual({ transcript: 'put some jazz on', command: 'play_jazz', via: 'jev', confidence: 0.8 });
  });

  it('off mode asks the matcher for exact keywords only', async () => {
    const { service, matcher } = make({ loc: kitchen('off'), match: { command: null, via: null, confidence: null, reason: 'model-off' } });
    const out = await service.handleTranscript('kitchen', 'put some jazz on');
    expect(matcher.match).toHaveBeenCalledWith(expect.objectContaining({ useModel: false }));
    expect(out).toMatchObject({ ok: false, code: 'VOICE_NO_MATCH', reason: 'model-off' });
  });

  it('no match answers VOICE_NO_MATCH with the reason', async () => {
    const { service, logger } = make({ match: { command: null, via: null, confidence: 0.3, reason: 'low-confidence', jevCommand: 'play_jazz' } });
    const out = await service.handleTranscript('kitchen', 'hmm');
    expect(out).toMatchObject({ ok: false, code: 'VOICE_NO_MATCH', reason: 'low-confidence', location: 'kitchen' });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.no_match', expect.objectContaining({ location: 'kitchen', reason: 'low-confidence' }));
  });
});

describe('VoiceTriggerService.confirm', () => {
  it('dispatches the stored command once and logs the confirmation', async () => {
    const { service, triggerDispatchService, logger, now } = make();
    await service.handleTranscript('kitchen', 'put some jazz on');
    now.t += 5000;
    const out = await service.confirm('kitchen', 'p1', { token: 't' });
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', { token: 't' });
    expect(out).toMatchObject({ ok: true, voice: { command: 'play_jazz', via: 'jev', confidence: 0.8, proposalId: 'p1' } });
    expect(logger.info).toHaveBeenCalledWith('trigger.voice.confirmed', expect.objectContaining({ proposalId: 'p1', command: 'play_jazz', latencyMs: 5000, ok: true }));
    expect((await service.confirm('kitchen', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
  });

  it('refuses expired, unknown and wrong-location proposals', async () => {
    const { service, now } = make();
    await service.handleTranscript('kitchen', 'jazz');
    expect((await service.confirm('garage', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
    now.t += 120001;
    expect((await service.confirm('kitchen', 'p1')).code).toBe('PROPOSAL_NOT_FOUND');
    expect((await service.confirm('kitchen', 'nope')).code).toBe('PROPOSAL_NOT_FOUND');
  });

  it('checks the token before consuming the proposal', async () => {
    const { service, triggerDispatchService } = make({ loc: kitchen('confirm', 'secret') });
    await service.handleTranscript('kitchen', 'jazz', { token: 'secret' });
    expect((await service.confirm('kitchen', 'p1', { token: 'bad' })).code).toBe('AUTH_FAILED');
    expect((await service.confirm('kitchen', 'p1', { token: 'secret' })).ok).toBe(true);
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledTimes(1);
  });
});

describe('voice through the real dispatch pipeline', () => {
  it('a routed transcript activates the configured scene and broadcasts on trigger:kitchen:voice', async () => {
    const activateScene = vi.fn(async () => ({ ok: true }));
    const actuationGateway = {
      clearDevice: vi.fn(), openDevice: vi.fn(), activateScene, invokeHomeAction: vi.fn(),
      sendTransport: vi.fn(() => ({ handled: false })), sendNotification: vi.fn(),
      disableAutomation: vi.fn(), enableAutomation: vi.fn(),
    };
    const broadcast = vi.fn();
    const config = configWith(kitchen('route'));
    const triggerDispatchService = new TriggerDispatchService({
      config, contentIdResolver: { resolve: () => null }, wakeAndLoadService: { execute: vi.fn() },
      actuationGateway, broadcast, logger: silent(),
      createDispatchId: () => 'd1', scheduler: { after: () => () => {} },
    });
    const service = new VoiceTriggerService({
      config, triggerDispatchService, logger: silent(), createProposalId: () => 'p1',
      matcher: matcherReturning({ command: 'lights_off', via: 'jev', confidence: 0.9, reason: null }),
    });

    const out = await service.handleTranscript('kitchen', 'kill the lights in here');

    expect(out.ok).toBe(true);
    expect(activateScene).toHaveBeenCalledWith('scene.kitchen_off');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ topic: 'trigger:kitchen:voice', value: 'lights_off', ok: true }));
  });
});
```

**Step 2: Run**

```bash
npx vitest run backend/src/3_applications/trigger/VoiceTriggerService.test.mjs
```

Expected: FAIL, cannot resolve `./VoiceTriggerService.mjs`.

**Step 3: Implement**

```js
/**
 * VoiceTriggerService — turns a transcript at a location into a trigger.
 *
 * Order: validate text → location → token (before any model call, so an
 * unauthenticated caller never spends a decision) → VoiceCommandMatcher →
 *   exact keyword          dispatch (the documented /voice/<keyword> contract)
 *   model match, route     dispatch
 *   model match, confirm   store a proposal; POST .../voice/confirm dispatches it
 *   anything else          VOICE_NO_MATCH, nothing happens
 *
 * Dispatch always goes through TriggerDispatchService.handleTrigger(location,
 * 'voice', command) so debounce, broadcast and response handling are the
 * same as every other modality.
 *
 * Proposals are in memory: a restart drops them, which only costs a re-ask.
 * Layer: APPLICATION (3_applications/trigger).
 */
import { authenticate } from './guards/authenticate.mjs';
import { VoiceResolver } from '#domains/trigger/services/VoiceResolver.mjs';

const MAX_TRANSCRIPT_CHARS = 500;
const PROPOSAL_TTL_MS = 120_000;
const MAX_PROPOSALS = 50;

export class VoiceTriggerService {
  #config; #matcher; #dispatch; #createProposalId; #clock; #logger;
  #proposals = new Map();

  /**
   * @param {Object} deps
   * @param {Object} deps.config - live trigger registry (reads config.voice.locations)
   * @param {Object} deps.matcher - VoiceCommandMatcher
   * @param {Object} deps.triggerDispatchService - TriggerDispatchService
   * @param {Function} deps.createProposalId
   * @param {Function} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ config, matcher, triggerDispatchService, createProposalId, clock = () => Date.now(), logger = console }) {
    if (typeof triggerDispatchService?.handleTrigger !== 'function') throw new Error('VoiceTriggerService requires triggerDispatchService');
    if (typeof matcher?.match !== 'function') throw new Error('VoiceTriggerService requires matcher');
    if (typeof createProposalId !== 'function') throw new Error('VoiceTriggerService requires createProposalId');
    this.#config = config || {};
    this.#matcher = matcher;
    this.#dispatch = triggerDispatchService;
    this.#createProposalId = createProposalId;
    this.#clock = clock;
    this.#logger = logger;
  }

  #locationConfig(location) {
    return this.#config?.voice?.locations?.[location] ?? null;
  }

  #guard(location, token) {
    const locationConfig = this.#locationConfig(location);
    if (!locationConfig) return { error: { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown voice location: ${location}`, location } };
    if (!authenticate({ expectedToken: locationConfig.auth_token, providedToken: token }).ok) {
      this.#logger.warn?.('trigger.voice.auth_failed', { location });
      return { error: { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location } };
    }
    return { locationConfig };
  }

  #prune(now) {
    for (const [id, p] of this.#proposals) {
      if (p.expiresAt < now) this.#proposals.delete(id);
    }
    while (this.#proposals.size >= MAX_PROPOSALS) {
      this.#proposals.delete(this.#proposals.keys().next().value);
    }
  }

  /**
   * @param {string} location
   * @param {string} transcript
   * @param {{ token?: string, dryRun?: boolean }} [options]
   */
  async handleTranscript(location, transcript, options = {}) {
    const text = typeof transcript === 'string' ? transcript.trim() : '';
    if (!text || text.length > MAX_TRANSCRIPT_CHARS) {
      return { ok: false, code: 'INVALID_TRANSCRIPT', error: `transcript must be 1..${MAX_TRANSCRIPT_CHARS} characters`, location };
    }
    const { locationConfig, error } = this.#guard(location, options.token);
    if (error) return error;

    const mode = locationConfig.routing?.mode ?? 'confirm';
    const match = await this.#matcher.match({ location, transcript: text, locationConfig, useModel: mode !== 'off' });

    if (!match.command) {
      this.#logger.info?.('trigger.voice.no_match', { location, reason: match.reason, mode });
      return { ok: false, code: 'VOICE_NO_MATCH', error: 'No configured command matched', location, reason: match.reason };
    }

    const voice = { transcript: text, command: match.command, via: match.via, confidence: match.confidence };

    if (match.via === 'exact' || mode === 'route') {
      const result = await this.#dispatch.handleTrigger(location, 'voice', match.command, { token: options.token, dryRun: options.dryRun });
      return { ...result, voice };
    }

    const now = this.#clock();
    this.#prune(now);
    const id = this.#createProposalId();
    this.#proposals.set(id, { location, command: match.command, via: match.via, confidence: match.confidence, createdAt: now, expiresAt: now + PROPOSAL_TTL_MS });
    this.#logger.info?.('trigger.voice.proposed', { proposalId: id, location, command: match.command, confidence: match.confidence, model: match.model ?? null });
    return {
      ok: true,
      confirm: true,
      location,
      proposal: {
        id,
        command: match.command,
        description: VoiceResolver.commandOptions(locationConfig)[match.command],
        confidence: match.confidence,
        expiresInMs: PROPOSAL_TTL_MS,
      },
    };
  }

  /**
   * Dispatch a stored proposal. One use; expires after PROPOSAL_TTL_MS.
   * @param {string} location
   * @param {string} proposalId
   * @param {{ token?: string }} [options]
   */
  async confirm(location, proposalId, options = {}) {
    const { error } = this.#guard(location, options.token);
    if (error) return error;

    const now = this.#clock();
    const proposal = this.#proposals.get(proposalId);
    if (!proposal || proposal.location !== location || proposal.expiresAt < now) {
      this.#logger.info?.('trigger.voice.confirm_missed', { proposalId: proposalId ?? null, location, expired: !!proposal && proposal.expiresAt < now });
      return { ok: false, code: 'PROPOSAL_NOT_FOUND', error: 'Proposal not found or expired', location };
    }
    this.#proposals.delete(proposalId);

    const result = await this.#dispatch.handleTrigger(location, 'voice', proposal.command, { token: options.token });
    this.#logger.info?.('trigger.voice.confirmed', {
      proposalId, location, command: proposal.command, confidence: proposal.confidence,
      latencyMs: now - proposal.createdAt, ok: !!result.ok, code: result.code ?? null,
    });
    return { ...result, voice: { command: proposal.command, via: proposal.via, confidence: proposal.confidence, proposalId } };
  }
}

export default VoiceTriggerService;
```

**Step 4: Run**

```bash
npx vitest run backend/src/3_applications/trigger/VoiceTriggerService.test.mjs && npm run audit:layers
```

Expected: PASS; audit clean.

**Step 5: Commit**

```bash
git add backend/src/3_applications/trigger/VoiceTriggerService.mjs backend/src/3_applications/trigger/VoiceTriggerService.test.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): VoiceTriggerService — transcript → exact/route dispatch or confirm proposal

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: HTTP endpoints `POST /:location/voice` and `/:location/voice/confirm`

**Files:**
- Modify: `backend/src/4_api/v1/routers/trigger.mjs:12-24` (status codes), `:26-35` (param), add routes before `return router;` at `:93`
- Create: `backend/src/4_api/v1/routers/trigger.voice.test.mjs`

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTriggerRouter } from './trigger.mjs';

const sideEffectExecutor = { execute: vi.fn() };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function appWith(voiceTriggerService) {
  const app = express();
  app.use('/api/v1/trigger', createTriggerRouter({
    triggerDispatchService: { handleTrigger: vi.fn(), setNote: vi.fn() },
    voiceTriggerService, sideEffectExecutor, logger,
  }));
  return app;
}

describe('trigger router — voice', () => {
  let voice;
  beforeEach(() => {
    voice = { handleTranscript: vi.fn(), confirm: vi.fn() };
  });

  it('POST /:location/voice passes transcript, token and dryRun', async () => {
    voice.handleTranscript.mockResolvedValue({ ok: true, confirm: true, proposal: { id: 'p1' } });
    const res = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice?token=t&dryRun=1').send({ transcript: 'put jazz on' });
    expect(res.status).toBe(200);
    expect(res.body.proposal.id).toBe('p1');
    expect(voice.handleTranscript).toHaveBeenCalledWith('kitchen', 'put jazz on', { token: 't', dryRun: true });
  });

  it('accepts the token in the body for callers that cannot set query strings', async () => {
    voice.handleTranscript.mockResolvedValue({ ok: true });
    await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x', token: 'bt' });
    expect(voice.handleTranscript).toHaveBeenCalledWith('kitchen', 'x', { token: 'bt' });
  });

  it.each([
    ['INVALID_TRANSCRIPT', 400],
    ['VOICE_NO_MATCH', 404],
    ['AUTH_FAILED', 401],
    ['LOCATION_NOT_FOUND', 404],
    ['DISPATCH_FAILED', 502],
  ])('maps %s to %i', async (code, status) => {
    voice.handleTranscript.mockResolvedValue({ ok: false, code });
    const res = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x' });
    expect(res.status).toBe(status);
  });

  it('POST /:location/voice/confirm dispatches a proposal; 410 when gone', async () => {
    voice.confirm.mockResolvedValueOnce({ ok: true, voice: { command: 'play_jazz' } });
    const ok = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice/confirm?token=t').send({ proposal: 'p1' });
    expect(ok.status).toBe(200);
    expect(voice.confirm).toHaveBeenCalledWith('kitchen', 'p1', { token: 't' });

    voice.confirm.mockResolvedValueOnce({ ok: false, code: 'PROPOSAL_NOT_FOUND' });
    const gone = await request(appWith(voice)).post('/api/v1/trigger/kitchen/voice/confirm').send({ proposal: 'p1' });
    expect(gone.status).toBe(410);
  });

  it('without a voice service the routes are not mounted', async () => {
    const res = await request(appWith(null)).post('/api/v1/trigger/kitchen/voice').send({ transcript: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
  });
});
```

**Step 2: Run**

```bash
npx vitest run backend/src/4_api/v1/routers/trigger.voice.test.mjs
```

Expected: FAIL, POST returns 404 (routes not mounted) and `handleTranscript` never called.

**Step 3: Implement**

In `STATUS_BY_CODE` add:

```js
  INVALID_TRANSCRIPT: 400,
  VOICE_NO_MATCH: 404,
  PROPOSAL_NOT_FOUND: 410,
```

Add `voiceTriggerService = null,` to the `createTriggerRouter` parameter list (after `sideEffectExecutor`), and before `return router;`:

```js
  // Voice: a transcript, not a keyword. Mounted only when composition built a
  // VoiceTriggerService. GET /:location/voice/:keyword (above) stays the
  // exact-keyword path and never touches the decision model.
  if (voiceTriggerService) {
    const send = (res, result) => res.status(result.ok ? 200 : (STATUS_BY_CODE[result.code] || 500)).json(result);

    router.post('/:location/voice', express.json(), asyncHandler(async (req, res) => {
      const { location } = req.params;
      const token = req.query.token ?? req.body?.token;
      const options = { token };
      if (req.query.dryRun === '1' || req.query.dryRun === 'true') options.dryRun = true;
      logger.debug?.('trigger.router.voice', { location, chars: typeof req.body?.transcript === 'string' ? req.body.transcript.length : null });
      return send(res, await voiceTriggerService.handleTranscript(location, req.body?.transcript, options));
    }));

    router.post('/:location/voice/confirm', express.json(), asyncHandler(async (req, res) => {
      const { location } = req.params;
      const token = req.query.token ?? req.body?.token;
      return send(res, await voiceTriggerService.confirm(location, req.body?.proposal, { token }));
    }));
  }
```

Note: with no token the service receives `{ token: undefined }`; vitest's `toHaveBeenCalledWith` ignores `undefined`-valued keys, so the assertions above hold either way.

**Step 4: Run**

```bash
npx vitest run backend/src/4_api/v1/routers/trigger.voice.test.mjs tests/isolated/api/routers/trigger.test.mjs tests/isolated/api/routers/trigger.sideEffect.test.mjs
```

Expected: PASS (existing router tests unaffected; they pass no voice service).

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/trigger.mjs backend/src/4_api/v1/routers/trigger.voice.test.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): POST /trigger/:location/voice and /voice/confirm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Composition wiring (decisionGateway → voice)

**Files:**
- Create: `backend/src/5_composition/modules/voiceTrigger.mjs`
- Create: `backend/src/5_composition/modules/voiceTrigger.test.mjs`
- Modify: `backend/src/5_composition/modules/triggerApi.mjs:4-13` (import), `:46-64` (destructure `decisionGateway`), `:87` (fallback registry), `:117-129` (build + pass service)
- Modify: `backend/src/app.mjs:5398-5420` (pass `decisionGateway`)

`voiceTrigger.mjs` is a separate module so it can be tested without importing `bootstrap.mjs` (which `triggerApi.mjs` does).

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { createVoiceTriggerService } from './voiceTrigger.mjs';

const config = {
  voice: { locations: { kitchen: {
    target: 'kitchen-display', auth_token: null, routing: { mode: 'route', confidenceFloor: null },
    commands: { play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' } },
  } } },
};
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('createVoiceTriggerService', () => {
  it('without a decision gateway, exact keywords still dispatch and free text is no match', async () => {
    const triggerDispatchService = { handleTrigger: vi.fn(async () => ({ ok: true })) };
    const svc = createVoiceTriggerService({ config, decisionGateway: null, triggerDispatchService, createProposalId: () => 'p', logger: silent });
    expect((await svc.handleTranscript('kitchen', 'play jazz')).ok).toBe(true);
    expect((await svc.handleTranscript('kitchen', 'some jazz please')).code).toBe('VOICE_NO_MATCH');
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledTimes(1);
  });

  it('with a decision gateway, free text is routed through it', async () => {
    const decisionGateway = {
      isConfigured: () => true,
      evaluate: vi.fn(async () => ({ model: 'm', answers: { command: { type: 'choice', choice: 'play_jazz', confidence: 0.9, probabilities: {} } } })),
    };
    const triggerDispatchService = { handleTrigger: vi.fn(async () => ({ ok: true })) };
    const svc = createVoiceTriggerService({ config, decisionGateway, triggerDispatchService, createProposalId: () => 'p', logger: silent });
    expect((await svc.handleTranscript('kitchen', 'some jazz please')).ok).toBe(true);
    expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    expect(triggerDispatchService.handleTrigger).toHaveBeenCalledWith('kitchen', 'voice', 'play_jazz', expect.any(Object));
  });
});
```

**Step 2: Run**

```bash
npx vitest run backend/src/5_composition/modules/voiceTrigger.test.mjs
```

Expected: FAIL, cannot resolve `./voiceTrigger.mjs`.

**Step 3: Implement**

`backend/src/5_composition/modules/voiceTrigger.mjs`:

```js
// backend/src/5_composition/modules/voiceTrigger.mjs
// Builds the voice-transcript trigger service. The decision gateway is
// optional: null (no Jev key) leaves exact keywords working and every free-text
// transcript answering VOICE_NO_MATCH.

import { VoiceCommandMatcher } from '#apps/trigger/VoiceCommandMatcher.mjs';
import { VoiceTriggerService } from '#apps/trigger/VoiceTriggerService.mjs';

/**
 * @param {Object} deps
 * @param {Object} deps.config - live trigger registry
 * @param {Object|null} [deps.decisionGateway] - IDecisionGateway
 * @param {Object} deps.triggerDispatchService
 * @param {Function} deps.createProposalId
 * @param {Object} [deps.logger]
 * @returns {VoiceTriggerService}
 */
export function createVoiceTriggerService({ config, decisionGateway = null, triggerDispatchService, createProposalId, logger = console }) {
  const matcher = new VoiceCommandMatcher({ decisionGateway, logger });
  return new VoiceTriggerService({ config, matcher, triggerDispatchService, createProposalId, logger });
}

export default createVoiceTriggerService;
```

`triggerApi.mjs`:

```js
import { createVoiceTriggerService } from './voiceTrigger.mjs';
```

Destructure `decisionGateway = null,` next to `learnerActions = null,` and document it in the JSDoc (`@param {Object} [config.decisionGateway] - IDecisionGateway for voice transcripts (optional; null keeps voice exact-keyword only)`).

Fallback registry at `:87`:

```js
    triggerConfig = { nfc: { locations: {}, tags: {} }, state: { locations: {} }, barcode: { locations: {} }, voice: { locations: {} }, responses: {}, endpoints: {} };
```

After `triggerDispatchService` is built (`:117`):

```js
  const voiceTriggerService = createVoiceTriggerService({
    config: triggerConfig,
    decisionGateway,
    triggerDispatchService,
    createProposalId: randomUUID,
    logger,
  });
```

and add `voiceTriggerService,` to the `createTriggerRouter({...})` call.

`app.mjs` inside the `createTriggerApiRouter({...})` call (after `commandResolver: resolveCommand,`):

```js
    // Voice transcripts (POST /trigger/:location/voice) match free text to a
    // location's commands with this; null leaves voice exact-keyword only.
    decisionGateway,
```

**Step 4: Run**

```bash
npx vitest run backend/src/5_composition/modules/voiceTrigger.test.mjs && npm run audit:layers && node --check backend/src/app.mjs && node --check backend/src/5_composition/modules/triggerApi.mjs
```

Expected: PASS; audit clean; both files parse.

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/voiceTrigger.mjs backend/src/5_composition/modules/voiceTrigger.test.mjs backend/src/5_composition/modules/triggerApi.mjs backend/src/app.mjs
git commit -m "$(cat <<'EOF'
feat(trigger): wire voice transcripts to the decision gateway

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/reference/trigger/events.md:191-193` (recipe 4), `:71` (modality list is fine; leave)
- Modify: `docs/reference/trigger/schema.md` — add a `## Voice sources` section before `## Precedence chain` (`:195`), fix `## Files` (`:227-234`)
- Modify: `docs/reference/trigger-endpoint.md:3-5` (config layout), `:26-38` (status codes), `:154-156` (replace "Future Modalities")

**Step 1: events.md recipe 4** — replace the "When the voice modality lands…" paragraph with:

```markdown
### 4. Voice routes to the Player overlay

Voice is a live modality (`modality: voice` in `triggers/sources.yml`). Two ways in:

- **Exact keyword:** `GET /api/v1/trigger/kitchen/voice/play_jazz` — the keyword must equal a
  configured command id after normalization (lowercase, non-alphanumerics → `_`). No model involved.
- **Transcript:** `POST /api/v1/trigger/kitchen/voice` with `{"transcript": "put some jazz on"}`.
  The exact keyword is tried first; otherwise the decision model (Jev) picks one of the location's
  commands or `none`. See [`schema.md` → Voice sources](./schema.md#voice-sources) for modes.

Either way the dispatch broadcasts on `trigger:kitchen:voice` with `value` = the command id, so a
kitchen-display screen subscribed to that topic shows whatever overlay you wire up. A proposal in
`confirm` mode broadcasts nothing until it is confirmed.

Speech-to-text is not part of the backend: the caller (HA Assist sentence trigger, a phone
shortcut's dictation) sends text.
```

**Step 2: schema.md** — add:

````markdown
## Voice sources

```yaml
kitchen-voice:
  modality: voice
  location: kitchen
  target: kitchen-display
  guards: { authenticate: { secret: <token> } }   # optional
  routing:
    mode: confirm            # off | confirm | route (default confirm)
    confidence_floor: 0.6    # optional, 0..1
  commands:
    play_jazz:
      description: Play jazz music on the kitchen display   # shown to the decision model
      action: play
      content: plex:12345
```

- Command ids are normalized (`Play Jazz` → `play_jazz`); two ids that normalize alike, and an id
  of `none`, are boot errors. Every command needs an `action` (same actions as `state`).
- `description` is what the decision model reads. Write it as the thing a person would ask for.
- **Modes** (transcripts only; exact keywords always dispatch):
  - `off` — exact keywords only.
  - `confirm` — a model match returns `{confirm: true, proposal: {id, command, description, confidence, expiresInMs}}`
    and dispatches nothing; `POST /trigger/<loc>/voice/confirm {"proposal": "<id>"}` within 120 s dispatches it once.
  - `route` — a model match at or above the floor dispatches directly. Promote from `confirm` only on the evidence in
    the log store (`trigger.voice.proposed` vs `trigger.voice.confirmed`, ≥ 30 proposals, ≥ 90 % confirmed).
- The decision is one `choice` over the commands plus `none`, 1.5 s timeout. Below the floor, `none`, a timeout, or no
  decision model configured → `404 VOICE_NO_MATCH` with `reason` (`low-confidence`, `none`, `decision-failed`,
  `no-decision-model`, `model-off`). Near misses log as `trigger.voice.near_miss`.
- The normal 30 s per-(location, modality, value) debounce applies: the same command twice within 30 s dispatches once.
- Log events: `trigger.voice.match`, `trigger.voice.near_miss`, `trigger.voice.decision_failed`,
  `trigger.voice.no_match`, `trigger.voice.proposed`, `trigger.voice.confirmed`, `trigger.voice.confirm_missed`,
  then the usual `trigger.fired`.
````

Fix `## Files` to the real paths:

```markdown
- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/{buildTriggerRegistry,sourcesParser,nfcLocationsParser,nfcTagsParser,stateLocationsParser,voiceLocationsParser}}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,BarcodeResolver,VoiceResolver,ResolverRegistry}.mjs`
- **Application:** `backend/src/3_applications/trigger/{TriggerDispatchService,mapIntentToResponse,responseHandlers,VoiceCommandMatcher,VoiceTriggerService}.mjs`
- **API router:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Composition:** `backend/src/5_composition/modules/{triggerApi,voiceTrigger}.mjs`
- **Tests:** `tests/isolated/{adapter,domain,application,api}/trigger/` plus colocated `*.test.mjs` for the voice modules
```

**Step 3: trigger-endpoint.md** — add rows to the status table:

```markdown
| 200 | (`ok: true, confirm: true`) | Voice transcript matched in `confirm` mode; nothing dispatched yet |
| 400 | `INVALID_TRANSCRIPT` | `POST …/voice` body had no transcript, or over 500 chars |
| 404 | `VOICE_NO_MATCH` | Transcript matched no command (see `reason`) |
| 410 | `PROPOSAL_NOT_FOUND` | `POST …/voice/confirm` with an unknown, used, or expired proposal |
```

Replace "Future Modalities" with a short "Voice" section pointing at `trigger/schema.md#voice-sources` and showing both calls:

```bash
curl -X POST "http://{env.prod_host}:{env.ports.app}/api/v1/trigger/kitchen/voice?token=…" \
  -H 'Content-Type: application/json' -d '{"transcript":"put some jazz on"}'
curl -X POST "http://{env.prod_host}:{env.ports.app}/api/v1/trigger/kitchen/voice/confirm?token=…" \
  -H 'Content-Type: application/json' -d '{"proposal":"<id from the first call>"}'
```

and change line 5's config layout sentence to: "Trigger config lives in `triggers/sources.yml` (one entry per source, keyed by source id, with `modality:`) plus `triggers/bindings/nfc/`, `responses.yml`, `endpoints.yml`."

**Step 4: Commit**

```bash
git add docs/reference/trigger/events.md docs/reference/trigger/schema.md docs/reference/trigger-endpoint.md
git commit -m "$(cat <<'EOF'
docs(trigger): voice modality — keyword + transcript routing, modes, log events

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full suite for touched dirs

**Step 1: Run**

```bash
npx vitest run \
  backend/src/1_adapters/trigger \
  backend/src/2_domains/trigger \
  backend/src/3_applications/trigger \
  backend/src/4_api/v1/routers/trigger.voice.test.mjs \
  backend/src/5_composition/modules/voiceTrigger.test.mjs \
  tests/isolated/adapter/trigger \
  tests/isolated/domain/trigger \
  tests/isolated/application/trigger \
  tests/isolated/api/routers/trigger.test.mjs \
  tests/isolated/api/routers/trigger.sideEffect.test.mjs \
  tests/isolated/composition/triggerLearnerActions.test.mjs
npm run audit:layers
node --check backend/src/app.mjs
```

Expected: all pass (Task 0 baseline count + the new tests), audit clean, app.mjs parses. `TriggerDispatchService.test.mjs:208-212` still expects `UNKNOWN_MODALITY` for voice, and still passes, because that test's hand-built registry has no `voice` slice. Do not change it.

**Step 2: Merge** (per repo workflow; do not deploy, do not start a second backend)

```bash
git checkout main && git merge --no-ff feat/voice-trigger-routing
```

Adding a voice source to the household `triggers/sources.yml` is a separate, post-deploy config step: the source starts in `confirm` mode by default, so a misconfigured description can only produce a proposal, never a silent action.
