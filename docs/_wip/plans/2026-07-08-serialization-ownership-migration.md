# Serialization-Ownership Migration (audit D-3)

**Status:** Phase 1 implemented (messaging + gratitude in-memory round-trippers). Phases 2+ pending.
**Ratchet:** `domains-tojson` content rule in `scripts/audit-layer-imports.mjs` counts `toJSON()` method *definitions* under `backend/src/2_domains/`. Baseline at plan time: **72 definitions** (75 files containing `toJSON()` text; 29 files with `static fromJSON`).

## Problem

Domain entities own their storage format via `toJSON()`/`fromJSON()`. This has two failure modes:

1. **Format logic in the domain layer** — the YAML/JSON shape is an adapter concern (see `docs/reference/core/adapter-layer-guidelines.md`, "Hydration Pattern" and the anti-pattern table: *"Format logic in domain: `toJSON()`/`fromJSON()` in entity → Hydration/dehydration in adapter"*). Entities can't rename internal fields without silently changing files on disk.
2. **In-memory round-tripping (the acute corruption, audit D-3)** — some domain *services* serialize entities to plain JSON and re-hydrate them **in memory**, not at any storage boundary. The aggregate then holds untyped blobs instead of child entities:
   - `2_domains/messaging/services/ConversationService.mjs` — `conversation.addMessage(message.toJSON())` on write, `conversation.messages.map(m => Message.fromJSON(m))` on read. `Conversation.messages` held plain objects.
   - `2_domains/gratitude/services/GratitudeService.mjs` — `store.addOption(hh, cat, item.toJSON())` / `items.map(i => GratitudeItem.fromJSON(i))` etc. The service, not the datastore, did (de)hydration.

## Target pattern

From `adapter-layer-guidelines.md` → Hydration Pattern (Datastores). The **datastore** owns both directions:

```javascript
export class YamlFooDatastore extends IFooDatastore {
  // Storage -> Domain
  #hydrate(raw) {
    return new Foo({ id: raw.id, name: raw.name, createdAt: raw.created_at });
  }
  // Domain -> Storage (explicit field mapping; the ONLY place the file shape is defined)
  #dehydrate(foo) {
    return { id: foo.id, name: foo.name, created_at: foo.createdAt };
  }
}
```

- Entity **loses** `toJSON()` / `static fromJSON()`.
- Entity **gains** explicit getters for everything the dehydrator needs (no reaching into private fields).
- Port interfaces (`3_applications/*/ports/I*Datastore.mjs`) speak **entities**, not plain objects.
- **Stored file shape must not change.** Every migration step is guarded by a stored-shape characterization test (write through the real datastore, snapshot the YAML/plain-object shape, refactor, assert identical).

### Worked example: `GratitudeItem` (done in phase 1)

Before — entity owns the format, service round-trips:

```javascript
// 2_domains/gratitude/entities/GratitudeItem.mjs
toJSON() { return { id: this.#id, text: this.#text }; }
static fromJSON(data) { return new GratitudeItem(data); }

// 2_domains/gratitude/services/GratitudeService.mjs
await this.#store.addOption(householdId, category, item.toJSON());
return shuffleArray(items.map(i => GratitudeItem.fromJSON(i)));
```

After — the datastore hydrates/dehydrates; the service passes and receives entities:

```javascript
// 1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs
#hydrateItem(raw) { return new GratitudeItem({ id: raw.id, text: raw.text }); }
#dehydrateItem(item) { return { id: item.id, text: item.text }; }

async getOptions(householdId, category) {
  return this.#readArray(householdId, `options.${category}`).map(r => this.#hydrateItem(r));
}
async addOption(householdId, category, item) {
  const options = this.#readArray(householdId, `options.${category}`);
  options.unshift(this.#dehydrateItem(item));
  this.#writeArray(householdId, `options.${category}`, options);
}

// 2_domains/gratitude/services/GratitudeService.mjs
await this.#store.addOption(householdId, category, item);   // entity in
return shuffleArray(await this.#store.getOptions(householdId, category)); // entities out
```

Stored YAML (`common/gratitude/options.gratitude.yml`) is byte-identical: a list of `{id, text}`.

### Transitional rule (phases 1–N)

Entities whose `toJSON()` is still consumed by the **API layer** for response DTOs (e.g. `4_api/v1/routers/gratitude.mjs`, `messaging.mjs` call `entity.toJSON()`) keep `toJSON()` *temporarily*. The full removal of an entity's `toJSON` requires moving response-DTO mapping into the router/application layer in the same step. `static fromJSON` is removed as soon as the datastore hydrates via constructor. The ratchet only permits the definition count to fall.

## Inventory (generated 2026-07-08)

Counts: `grep -rln "toJSON()" backend/src/2_domains --include='*.mjs' | grep -v test` → **75 files**; `grep -rln "static fromJSON" ...` → **29 files**; adapter call sites `grep -rn "\.toJSON()\|\.fromJSON(" backend/src/1_adapters --include='*.mjs' | grep -v test` → **27 sites in 14 files**.

| # | Entity / VO (2_domains) | Datastore(s) / adapter call sites (1_adapters) | Phase |
|---|---|---|---|
| 1 | `messaging/entities/Conversation`, `Message` (+ service round-trip) | `persistence/yaml/YamlConversationDatastore` (save) | **1 — done** |
| 2 | `gratitude/entities/GratitudeItem`, `Selection` (+ service round-trip) | `persistence/yaml/YamlGratitudeDatastore` (all reads/writes were plain; service did the (de)hydration) | **1 — done** |
| 3 | `nutrition|lifelog/entities/NutriLog`, `FoodItem` | `persistence/yaml/YamlNutriLogDatastore` (7 sites), `YamlFoodLogDatastore` (1) | 2 (nutrition group) |
| 4 | `health/entities/FoodCatalogEntry` | `persistence/yaml/YamlFoodCatalogDatastore` (2) | 2 (nutrition group) |
| 5 | `cost/entities/CostEntry`, `CostBudget` + 7 cost VOs (`Money`, `CostCategory`, `Attribution`, `BudgetPeriod`, `SpreadSource`, `Thresholds`, `Usage`) | `cost/YamlCostDatastore` (4) | 3 (cost group; VOs migrate with owning aggregate) |
| 6 | `scheduling/entities/JobState`, `Job`, `JobExecution` | `scheduling/YamlStateDatastore` (2) | 4 (scheduling) |
| 7 | `media/entities/MediaQueue` | `persistence/yaml/YamlMediaQueueDatastore` (2) | 5 (media/content) |
| 8 | `content/entities/MediaProgress`, `content/value-objects/ItemId` | `persistence/yaml/YamlMediaProgressMemory` (1) | 5 (media/content) |
| 9 | `fitness/entities/Session`, `Participant`, `Zone`, `value-objects/SessionId` | `persistence/yaml/YamlSessionDatastore` (1) | 6 (fitness) |
| 10 | `lifeplan/entities/LifePlan` + 17 child entities (`Goal`, `Value`, `Belief`, …) | `persistence/yaml/YamlLifePlanStore` (1) | 7 (lifeplan — largest aggregate, do last of the datastore groups) |
| 11 | `journaling/entities/JournalEntry` | `persistence/yaml/YamlJournalDatastore` (1) | 8 (journaling) |
| 12 | `feed/entities/Headline` | `feed/RssHeadlineHarvester` (1) | 9 (feed) |
| 13 | `notification/entities/NotificationIntent`, `NotificationPreference` | `notification/AppNotificationAdapter` (1 — broadcast DTO, not storage; dehydrate in the adapter) | 9 |
| 14 | `messaging/entities/Notification`, `value-objects/ConversationId`, `ResolvedIdentity` | no adapter call site — `toJSON` consumed by API/response DTOs | 10 (API DTO mapping) |
| 15 | `journalist/entities/*` (5 files), `barcode/BarcodePayload`, `entropy/EntropyItem`, `finance/entities/*` (4), `health/HealthMetric`, `WorkoutEntry`, `HealthAggregationService`, `livestream/StreamChannel`, `playback-hub/value-objects/*` (6) | no 1_adapters call site found — consumers are application/API layers or the entity's own aggregate; audit each when its domain is touched | 10 (as touched) |

(`1_adapters/agents/YamlWorkingMemoryAdapter` round-trips `WorkingMemoryState`, which lives outside `2_domains` — out of scope for this ratchet but same pattern applies.)

## Phases & exit criteria

**Ordering principle:** (1) in-memory round-trippers first — they corrupt the model at runtime, not just at the boundary; (2) then per-datastore groups, migrated opportunistically **as their domain is touched** (no big-bang); (3) API-DTO-only `toJSON`s last, since they need router changes.

### Phase 1 — in-memory round-trippers (THIS TASK, done)
- `ConversationService`: `Conversation` holds `Message` entities; `addMessage(message)` takes the entity; `YamlConversationDatastore` hydrates on load (`#hydrate`) and dehydrates on save (`#dehydrate`). `Conversation.fromJSON`/`Message.fromJSON` removed; `toJSON` retained (messaging router response DTOs).
- `GratitudeService`: store port speaks `GratitudeItem`/`Selection` entities; `YamlGratitudeDatastore` owns hydrate/dehydrate; `GratitudeItem.fromJSON`/`Selection.fromJSON` removed; `toJSON` retained (gratitude router response DTOs). Service DTO shaping (`bootstrap`, `getSelectionsForPrint`) uses explicit getters, not `toJSON`.
- Exit: `grep -n "fromJSON\|toJSON" <both service files>` → 0 lines; stored-shape characterization tests (`tests/unit/domains/messaging/conversationStoredShape.char.test.mjs`, `tests/unit/domains/gratitude/gratitudeStoredShape.char.test.mjs`) pass before AND after; all gates green. ✅

### Phases 2–9 — per-datastore groups (rows 3–13 above)
Repeatable recipe per group:
1. Write a stored-shape characterization test through the CURRENT code (round-trip representative entities via the real datastore; snapshot the written plain-object/YAML shape).
2. Add `#hydrate`/`#dehydrate` to the datastore with explicit field mapping (copy the current `toJSON()` body into `#dehydrate`; the current constructor/`fromJSON` body into `#hydrate`).
3. Point every datastore read/write at them; update the port JSDoc to entity types.
4. Delete `static fromJSON` from the entity. Delete `toJSON` too **unless** an API router or application-layer consumer still calls it (then leave it and record the consumer in this doc).
5. Add getters for any private field the dehydrator needs.
6. Exit criteria (every group): characterization test unchanged and green; `domains-tojson` ratchet count strictly lower (run `node scripts/audit-layer-imports.mjs --update` after verifying); GATE-IMPORT/AUDIT/UNIT/REFACTOR green; no stored file shape change.

### Phase 10 — API-DTO `toJSON`s (rows 14–15)
- Move response-DTO mapping into routers (or a thin presenter next to the router): `res.json({ item: toItemDto(entity) })`.
- Then delete the remaining entity `toJSON`s. Exit: `domains-tojson` count 0, ratchet rule flipped to hard-zero.

## Verification commands

```bash
node scripts/audit-layer-imports.mjs --list=domains-tojson   # remaining definitions
grep -rln "static fromJSON" backend/src/2_domains --include='*.mjs' | grep -v test
npm run test:unit && npm run test:refactor
```
