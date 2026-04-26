# Trigger Config — Modality Architecture

**Date:** 2026-04-26
**Status:** Design — pending user review
**Touches:** `backend/src/2_domains/trigger/`, `backend/src/3_applications/trigger/`, `backend/src/0_system/bootstrap.mjs`, `data/household/config/nfc.yml` → `data/household/config/triggers/`, `docs/reference/trigger/`

---

## Problem

The current trigger config (`data/household/config/nfc.yml`) conflates three independent concerns into one location-rooted shape:

```yaml
livingroom:
  target: livingroom-tv
  action: play
  tags:                    # NFC modality data
    8d_6d_2a_07:
      plex: 620707
  states:                  # state modality data
    off:
      action: clear
```

This causes four problems:

1. **Tag identity is bound to a location.** The same physical NFC card cannot be defined once and used at multiple readers — it would have to be duplicated under each location entry.
2. **Per-reader content variation requires duplication.** The same Plex ID played from two readers, with different shader/volume/target, has to be expressed as two separate tag entries.
3. **The filename `nfc.yml` is misleading** — it actually contains state triggers too. Adding voice/barcode would either pollute it further or fragment naming further.
4. **`/trigger` and `/load` are conceptually distinct, but the config doesn't reflect it.** `/load` takes a known content ID and plays it. `/trigger` takes a raw signal (tag UID, barcode, utterance, state value) that *needs resolution* into something playable. The trigger config is fundamentally a registry of resolvers for raw inputs — but the current shape obscures that.

## Conceptual model

The trigger system is **a dispatcher of resolved actions from raw input signals**. Each modality is a different kind of raw input with its own resolver:

| Modality | Raw input | Resolver | Output |
|---|---|---|---|
| `nfc` | tag UID `8d_6d_2a_07` | tag-registry lookup (deterministic table) | content ID `plex:620707` + load query |
| `state` | entity state `off` | per-location action map (deterministic, location-scoped) | action `clear` |
| `barcode` (future) | UPC `012345678905` | product-registry lookup (deterministic) | content ID + load query |
| `voice` (future) | utterance `"play led zeppelin"` | LLM intent parse + content search (probabilistic) | content ID + load query |

Once resolved, the output joins the existing `wakeAndLoadService` pipeline — the same path `/api/v1/device/<target>/load` uses today. So **`/trigger` = `(resolve)` + `/load`**.

## File layout

Replace `data/household/config/nfc.yml` with a per-modality directory tree:

```
data/household/config/triggers/
  nfc/
    locations.yml      # NFC reader locations: target, default action, default shader, auth, etc.
    tags.yml           # universal tag registry: UID → content + per-location override blocks
  state/
    locations.yml      # state-source locations + state-value → action maps
  # future modalities sit alongside as siblings:
  # voice/locations.yml + voice/intents.yml
  # barcode/locations.yml + barcode/products.yml
```

Each modality dir is self-contained. A modality may have:
- A `locations.yml` (always — defines the trigger sources of that modality and their defaults)
- One or more registry/resolver-data files (`tags.yml`, `intents.yml`, etc.) — depends on modality
- A code-only resolver (some modalities, like voice, may need no static data file — the resolver is an LLM call)

## Schema — `triggers/nfc/locations.yml`

Each top-level key is a reader/location ID (matches the URL `/api/v1/trigger/<location>/...`). Keys define defaults inherited by every tag scanned at that reader.

```yaml
livingroom:
  target: livingroom-tv     # device that receives the resolved load command
  action: play-next         # default action for this reader (overridable on tag)
  shader: default           # default shader (overridable per-tag, per-reader-on-tag)
  volume: 15                # default volume (overridable per-tag, per-reader-on-tag)
  auth_token: null          # optional auth token (omit or null = no auth required)

bedroom:
  target: bedroom-tv
  action: play-next
  shader: blackout          # bedroom defaults to dim shader for everything
  volume: 8
```

**Reserved keys** (consumed as first-class fields, not inherited as load query params): `target`, `action`, `auth_token`.

**Defaults** (inheritable into the resolved load query): all other keys. `shader`, `volume`, `shuffle`, `continuous`, etc. flow through.

## Schema — `triggers/nfc/tags.yml`

Each top-level key is a tag UID. Universal — defined once, recognized at any reader in `nfc/locations.yml`.

```yaml
8d_6d_2a_07:
  plex: 620707              # tag-global content (shorthand: plex:620707)
  shader: default           # tag-global override (applies regardless of reader)
  livingroom:               # ← key matches a reader ID → per-reader override block
    shader: blackout        #   when scanned at livingroom, use blackout
  bedroom:
    shader: night
    volume: 5

83_8e_68_06:
  plex: 620707              # different tag, same content, no overrides

41_2a_7c_99:
  files: bedtime/lullabies  # different content prefix
  livingroom:
    target: livingroom-tv   # rare: per-reader can even override target
    shader: blackout
```

**Tag-level reserved keys** (consumed as the resolved intent): `action`, `target`, `content`. (Same as today's `RESERVED_KEYS` in `TriggerIntent.mjs`.)

**Tag-global fields** (top-level non-reader-id keys): merge into the load query for any reader that scans this tag, overriding reader defaults.

**Per-reader override blocks** (top-level keys that match a reader ID in `nfc/locations.yml`): merge after tag-global fields, overriding both reader defaults and tag-global fields, but ONLY when scanned at that reader.

**Disambiguation rule:** the parser distinguishes "tag-global field" vs "reader-override block" by checking if the key's *value* is an object/map. A scalar value (string/number/bool) is always a tag-global field. An object value is a reader-override block — and the key MUST match a registered reader ID in `nfc/locations.yml`, or the parser emits a `ValidationError` (this catches typos like `livingrm: { shader: blackout }` instead of silently dropping the override).

This rule keeps tag-global fields open-ended (any scalar key flows into the load query — `shader`, `volume`, `shuffle`, future params) while making reader overrides strictly validated.

This requires `locations.yml` to be parsed before `tags.yml` so the parser knows the set of valid reader IDs.

## Schema — `triggers/state/locations.yml`

Same shape as NFC locations, but with a `states:` block instead of any tag registry (state events aren't universal — the entity that emitted them is location-bound):

```yaml
livingroom:
  target: livingroom-tv
  states:
    off:
      action: clear
    on:
      action: play
      queue: ambient-loop
```

State doesn't get its own registry file because there is no universal "state" registry — the action map is inherently per-location.

## Precedence chain

For an NFC scan at reader `R` of tag `T`, the final load query is built by deep-merging in this order (later wins):

```
final = {} (empty)
      ← system_default                   (e.g., shader = 'default')
      ← reader[R].defaults               (from nfc/locations.yml — shader, volume, etc.)
      ← tag[T].global                    (from nfc/tags.yml — top-level non-reader keys)
      ← tag[T][R]                        (from nfc/tags.yml — reader-id-keyed override block)
```

`action` and `target` follow the same chain (reserved keys can be overridden too — useful for an "audio-only" tag that forces a different target even from a video-capable reader).

`content` is resolved from the tag registry only (tags.yml `plex:`, `files:`, etc. shorthand). Reader defaults don't supply content.

## Layering (DDD)

The current `2_domains/trigger/{TriggerConfig,TriggerIntent}.mjs` files conflate three layers. The redesign separates them properly:

| Layer | Responsibility | New files |
|---|---|---|
| **Adapter (`1_adapters/trigger/`)** | Knows YAML structure. Loads files, validates schema, classifies keys (e.g., scalar-vs-object disambiguation), assembles the unified registry. | `YamlTriggerConfigRepository.mjs` (public entry, does I/O), `parsers/{nfcLocationsParser, nfcTagsParser, stateLocationsParser, buildTriggerRegistry}.mjs` (pure, no I/O) |
| **Domain (`2_domains/trigger/services/`)** | Cross-entity resolution logic. Pure functions over already-parsed shapes. No knowledge of YAML, no I/O, no vendor coupling. | `NfcResolver.mjs`, `StateResolver.mjs`, `ResolverRegistry.mjs` (stateless classes with `resolve()` method, per `domain-layer-guidelines.md`) |
| **Application (`3_applications/trigger/`)** | Orchestrates the trigger lifecycle: auth → debounce → resolve → dispatch action → broadcast. Already lives here; only its imports change. | `TriggerDispatchService.mjs` (existing, refactored body), `actionHandlers.mjs` (existing, unchanged) |

**Why parsers are adapters, not domain:** the DDD guideline says "Adapter (Repository) — Maps storage format ↔ domain entities." Trigger config is *stored as YAML*. Anything that knows YAML key shape (`tags:` vs `states:`, scalar-vs-object as override-block disambiguation) operates at the storage-format boundary — that's adapter work regardless of whether the data describes NFC tags or anything else. `1_adapters/trigger/parsers/` is testable in isolation; `YamlTriggerConfigRepository.mjs` is the I/O wrapper bootstrap calls.

**Why resolvers are domain, not application:** they're stateless cross-entity logic (combine reader-config + tag-config to produce an intent), no I/O, no external services. That's the textbook definition of a domain service per the guidelines (`ZoneService` example).

**Pre-existing violations resolved:** the old `2_domains/trigger/TriggerConfig.mjs` (a YAML-shape parser in domain) and `2_domains/trigger/TriggerIntent.mjs` (whose `resolveIntent` mixed location/entry merging — domain logic — with shorthand expansion that uses `contentIdResolver`) are both deleted. The location-merging + shorthand expansion moves into `NfcResolver`.

## Parser pipeline

```
loadFile('config/triggers/nfc/locations')   ─┐
loadFile('config/triggers/nfc/tags')        ─┤
loadFile('config/triggers/state/locations') ─┤
                                             │
                                             ▼
                  YamlTriggerConfigRepository.loadRegistry({ loadFile })
                                             │
                            ┌────────────────┴───────────────┐
                            │  parsers/buildTriggerRegistry  │   (pure, no I/O)
                            │  ├─ nfcLocationsParser         │
                            │  ├─ nfcTagsParser              │
                            │  └─ stateLocationsParser       │
                            └────────────────┬───────────────┘
                                             │
                                             ▼
                       { nfc: { locations, tags }, state: { locations } }
                                             │
                                             ▼
                           passed to TriggerDispatchService
```

The dispatcher consumes the unified shape but never knows about YAML — it only ever sees parsed domain-shaped data.

## Resolver registry

`actionHandlers` (in `3_applications/trigger/actionHandlers.mjs`) is the *action* registry — what to do *after* resolution. The new domain-layer `ResolverRegistry` is the parallel *resolver* registry — how to produce an intent from a (modality, location, value) tuple:

- `NfcResolver.resolve({ location, value, registry, contentIdResolver })` → resolved intent. Universal tag lookup + reader-default merging + per-reader override + content-shorthand expansion.
- `StateResolver.resolve({ location, value, registry })` → resolved intent. Location-scoped state-value lookup.
- `ResolverRegistry.resolve({ modality, location, value, registry, contentIdResolver })` → dispatches to the correct resolver. Throws `UnknownModalityError` for unregistered modalities.

`TriggerDispatchService.handleTrigger` becomes:

```javascript
const intent = ResolverRegistry.resolve({
  modality, location, value, registry: this.#config, contentIdResolver: this.#contentIdResolver,
});
if (!intent) return { ok: false, code: 'TRIGGER_NOT_REGISTERED', ... };
intent.dispatchId = dispatchId;
return dispatchAction(intent, this.#deps);
```

Each resolver gets only its modality slice of the registry (no cross-modality peeking) — the registry passes `registry.nfc` to `NfcResolver`, `registry.state` to `StateResolver`. Adding voice = a new resolver class + entry in the `resolvers` map; no changes elsewhere.

## Migration

The current production `nfc.yml` has one location (`livingroom`) with two NFC tags and one state mapping. One-shot rewrite — no backward-compat shim, no dual-path parser.

**Old:**
```yaml
# data/household/config/nfc.yml
livingroom:
  target: livingroom-tv
  action: play-next
  tags:
    83_8e_68_06: { plex: 620707 }
    8d_6d_2a_07: { plex: 620707 }
  states:
    off: { action: clear }
```

**New:**
```yaml
# data/household/config/triggers/nfc/locations.yml
livingroom:
  target: livingroom-tv
  action: play-next

# data/household/config/triggers/nfc/tags.yml
83_8e_68_06:
  plex: 620707
8d_6d_2a_07:
  plex: 620707

# data/household/config/triggers/state/locations.yml
livingroom:
  target: livingroom-tv
  states:
    off:
      action: clear
```

Migration steps (deliverables in the implementation plan):

1. Create `triggers/nfc/locations.yml`, `triggers/nfc/tags.yml`, `triggers/state/locations.yml` from the current `nfc.yml` content.
2. Delete `nfc.yml` (and the conflicted-copy + .bak files identified in finding F7 of `2026-04-25-nfc-to-playback-trigger-sequence-audit.md`).
3. Update `bootstrap.mjs` config-load path from `nfc.yml` → directory walk under `triggers/`.
4. ConfigService entry: deprecate `nfc` key; introduce `triggers` key returning the unified registry.
5. Reload endpoint `/api/v1/trigger/reload` re-walks the directory (no API contract change).

## Documentation updates

In addition to the spec/plan docs, the following reference docs MUST be updated by the implementation (they describe the runtime contract):

- `docs/reference/trigger/events.md` — replace every `livingroom: tags: ...` YAML example with the new modality-rooted shape. Update the §"Files" section to reference `2_domains/trigger/loadTriggerConfig.mjs` and the per-modality parser/resolver maps. The "Two Output Paths, One Event" section, "Broadcast Payload" shape, and screen-subscription contract are all unchanged — only the underlying config layout changed.
- `docs/reference/trigger-endpoint.md` — confirm URL contract is unchanged (`/api/v1/trigger/<location>/<modality>/<value>` still applies). Add a note that locations are now resolved per-modality (a location may exist as an NFC source but not as a state source, etc.). Refresh any embedded YAML examples.
- New doc: `docs/reference/trigger/schema.md` — single-page reference for the per-modality schema, precedence chain, reserved-key list, and the scalar-vs-object disambiguation rule. This becomes the canonical lookup for "how do I add a new tag?" / "how do I add a per-reader override?" / "how do I add a new modality?"

## Forward compatibility

Adding a new modality (voice/barcode) requires:
1. A new dir `data/household/config/triggers/<modality>/` with `locations.yml` + any registry files.
2. A new modality parser registered in `modalityParsers`.
3. A new resolver registered in `resolvers`.
4. (Optional) a new action handler if the modality unlocks a new action type — usually unnecessary; voice/barcode resolve into existing `play`/`queue` actions.

No changes to dispatcher, action handlers, broadcast, or screen subscription handler. The screen-framework subscription topic (`trigger:<location>:<modality>`) generalizes for free.

## Out of scope / deferred

- **Schema migration tool** — the dataset is tiny (1 location, 2 tags, 1 state). One-shot manual edit. Skip writing a migration script.
- **JSON-Schema validation file** — not needed today; the parser's `ValidationError` paths give actionable errors. Add when the config grows beyond ~20 entries.
- **Per-modality auth strategies** — voice/barcode auth (e.g., voice-print verification) is out of scope; both will use the same `auth_token` model NFC uses. Revisit when implementing.
- **Tag aliases** — the audit noted `83_8e_68_06` and `8d_6d_2a_07` both map to `plex:620707`. An alias system (`alias_of: 83_8e_68_06`) would dedupe this, but the registry is too small to bother. Two-line duplication is fine.
- **Cross-modality coordination** — e.g., "if voice triggers within 5s of an NFC scan, voice wins." No use case today.
- **State-modality registry file** — could in principle universalize state mappings (e.g., "`off` always means `clear`"), but the location-bound nature of state events means there's no real win. Keep states inline in `state/locations.yml`.

## Acceptance criteria

The redesign is done when:

1. Config files exist at `data/household/config/triggers/{nfc,state}/...` with the schema above.
2. Old `nfc.yml` (and its `.bak` / conflicted-copy siblings) are deleted from prod.
3. Backend boots successfully and `/api/v1/trigger/reload` reports the new locations/tag counts.
4. NFC tap on physical tag `8d_6d_2a_07` at the living-room reader still triggers `wakeAndLoadService.execute('livingroom-tv', { 'play-next': 'plex:620707', op: 'play-next' })` end-to-end.
5. State trigger `GET /api/v1/trigger/livingroom/state/off` still calls `device.clearContent()` on `livingroom-tv`.
6. A *new* tag added to `tags.yml` with a `livingroom: { shader: blackout }` override results in the player mounting with `shader='blackout'` when scanned at `livingroom`, and `shader='default'` (or whatever the bedroom default is) when scanned at `bedroom`.
7. `docs/reference/trigger/events.md` and the new `docs/reference/trigger/schema.md` reflect the new shape; no reference doc references the old `nfc.yml` path.
8. All existing trigger tests pass; new tests cover: per-reader override on tag, universal tag scanned at multiple readers, validation error on unknown reader-id key in a tag.
