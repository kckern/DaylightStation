# Trigger Config Schema

How the per-modality YAML files under `data/household/config/triggers/` are structured, parsed, and merged at resolution time. This is the canonical reference — if `events.md` and this disagree, this wins.

For the runtime contract (HTTP endpoint, status codes, broadcast shape), see [`events.md`](./events.md) and [`../trigger-endpoint.md`](../trigger-endpoint.md).

---

## Directory layout

```
data/household/config/triggers/
  nfc/
    locations.yml      # NFC reader sources + per-reader defaults
    tags.yml           # universal tag UID registry
  state/
    locations.yml      # state-source locations + state-value action maps
  # (future modalities live as siblings: voice/, barcode/, etc.)
```

Each modality is self-contained. A modality may have:
- A `locations.yml` (always — defines the trigger sources of that modality and their defaults)
- One or more registry/resolver-data files (`tags.yml`, `intents.yml`, etc.)
- A code-only resolver (some modalities, like voice, may need no static data file)

---

## `triggers/nfc/locations.yml`

Each top-level key is an NFC reader location ID. The key matches the URL `/api/v1/trigger/<location>/nfc/<value>`.

```yaml
livingroom:
  target: livingroom-tv     # device that receives the resolved load command
  action: play-next         # default action for tags scanned at this reader
  shader: default           # default shader (flows into load query)
  volume: 15                # default volume
  auth_token: null          # optional auth (omit or null = no auth)
```

**Reserved fields** (consumed as first-class config):
- `target` (REQUIRED, non-empty string) — the device ID this reader controls
- `action` (optional) — the default action for tags here; overridable per tag
- `auth_token` (optional, string or null) — required auth token; null = no auth

**Defaults** (everything else, e.g. `shader`, `volume`, `shuffle`, `continuous`) — flow into the load query as the lowest-precedence layer for any tag scanned at this reader.

---

## `triggers/nfc/tags.yml`

Universal tag registry. Each top-level key is a tag UID (case-insensitive — the parser lowercases). Tags are recognized at any reader in `nfc/locations.yml`.

```yaml
8d_6d_2a_07:
  plex: 620707              # tag-global content (shorthand: plex:620707)
  shader: default           # tag-global override
  livingroom:               # ← key matches a reader ID → per-reader override block
    shader: blackout        #   (only applies when scanned at livingroom)
  bedroom:                  # ← another override block
    shader: night
    volume: 5
```

### Disambiguation rule (scalar vs object)

A tag's top-level keys are classified by the *value's type*:

| Value type | Treated as | Constraint |
|---|---|---|
| Scalar (string, number, bool, null) | tag-global field | none |
| Array | tag-global field | none |
| Object (plain) | per-reader override block | key MUST match a registered reader ID in `nfc/locations.yml` |

If a tag has an object-valued key whose name does NOT match a registered reader, the parser throws `ValidationError(code: 'UNKNOWN_READER_OVERRIDE')`. This catches typos like `livingrm: { shader: blackout }`.

### Reserved tag fields

Inside the tag body (and inside any per-reader override block), these keys are consumed as first-class intent fields rather than passing through as load-query params: `action`, `target`, `content`, `scene`, `service`, `entity`, `data`. (Same `RESERVED_KEYS` set used by the previous `TriggerIntent.resolveIntent`.)

---

## Unknown tag capture (lifecycle)

A tag's lifecycle is **derived from its YAML fields**, not stored as a flag. `NfcResolver.resolve` returns `null` for any tag with no actionable field (`content`, `scene`, `service`, `entity`), so the dispatcher routes such scans into the unknown-tag handler:

| State | YAML shape | Behavior on scan |
|---|---|---|
| 0 — never seen | (no entry) | Backend creates placeholder with `scanned_at: "..."`, sends iOS/Android push (if `notify_unknown:` set), broadcasts `registered: false` |
| 1 — placeholder, no reply yet | `{ scanned_at: "..." }` | Backend re-sends push (if configured); placeholder write is idempotent. Subject to the 3 s debounce window. |
| 2 — reply received, awaiting promotion | `{ scanned_at: "...", note: "..." }` | Silent — broadcast still fires for observer dashboards; no push, no write |
| 3 — promoted to a real tag | `{ plex: 12345, ... }` (or `scene:`, `service:`, etc.) | Normal dispatch — never enters this flow |

**Fields:**

- `scanned_at` (string, quoted) — set by the backend on the **first** scan that creates the entry, in container-local format `"YYYY-MM-DD HH:MM:SS"` (sv-SE locale). **Never updated** after creation.
- `note` (string) — set by `PUT /api/v1/trigger/<location>/nfc/<uid>/note` when the user submits an Android/iOS Companion REPLY. Overwrites on each PUT (last reply wins). Ignored by `NfcResolver.resolve`.

**Promotion** is "add an intent field" (`plex`, `scene`, `service`, etc.) by editing the YAML directly. The leftover `scanned_at:` and `note:` are harmless and may be hand-cleaned at the user's discretion.

**`notify_unknown` field on `nfc/locations.yml`:**

```yaml
livingroom:
  target: livingroom-tv
  action: play-next
  notify_unknown: mobile_app_kc_phone   # optional — HA notify service name
```

When set, the backend calls `haGateway.callService('notify', <value>, { title, message, data: { actions: [{ action: "NFC_REPLY|<location>|<uid>", behavior: "textInput", title: "Add note", ... }] } })` on every state-0 or state-1 scan. The action ID encodes location + UID so the HA reply automation is stateless.

When omitted/null: the placeholder is still written and the broadcast still fires; only the push notification is skipped.

**HA-side wiring** (lives at `/_includes/rest_commands/nfc.yaml` and `/_includes/automations/nfc_unknown_tag_reply.yaml` on the HA host):
- `rest_command.nfc_set_note` issues the `PUT …/note` to the backend.
- `nfc_unknown_tag_reply` automation listens for `mobile_app_notification_action` events whose `action` starts with `NFC_REPLY|`, parses out location + uid, and calls the rest_command with the user's `reply_text`.

**Caveat**: the YAML round-trip via `js-yaml` strips top-of-file comments. The first placeholder write to `tags.yml` removes any header comment block. The schema documented here is the canonical source.

---

## `triggers/state/locations.yml`

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

State events are inherently location-bound (every entity_id belongs to one location), so there's no universal state registry — the action map is per-location.

**Schema:**
- `target` (REQUIRED) — same as NFC.
- `auth_token` (optional) — same as NFC.
- `states` (optional, object) — keyed by the state value (lowercased on parse). Each entry MUST have an `action`. Other fields flow into params; `target` can be overridden per-state if needed.

---

## Precedence chain

For an NFC scan at reader `R` of tag `T`, the final load query is built by spread-merging in this order (later wins):

```
final = {}
      ← reader[R].defaults              (from nfc/locations.yml — shader, volume, etc.)
      ← tag[T].global                   (from nfc/tags.yml — top-level scalar/array values)
      ← tag[T].overrides[R]             (from nfc/tags.yml — reader-id-keyed object value)
```

`action` and `target` follow the same chain — reserved keys can be overridden too. Useful for an "audio-only" tag that forces a different target even from a video-capable reader.

`content` is resolved from the tag-global / override layers only. Reader defaults don't supply content (a reader is a binding policy, not content).

---

## Adding a new modality

To add `voice`, `barcode`, etc.:

1. Create the data dir + files: `data/household/config/triggers/<modality>/locations.yml` (+ any registry files like `intents.yml`).
2. Add a parser at `backend/src/1_adapters/trigger/parsers/<modality>LocationsParser.mjs` (and any registry parsers).
3. Wire the parser into `buildTriggerRegistry` in `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`.
4. Add a resolver class at `backend/src/2_domains/trigger/services/<Modality>Resolver.mjs` (PascalCase, with `static resolve(...)`).
5. Register the resolver class in `backend/src/2_domains/trigger/services/ResolverRegistry.mjs` (`resolvers` map).
6. Update `YamlTriggerConfigRepository` to load the new YAML blobs.

No changes needed to `TriggerDispatchService`, `actionHandlers`, the WebSocket broadcast, or the screen-framework subscription handler. The screen subscription topic (`trigger:<location>:<modality>`) generalizes for free.

---

## Files

- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/{buildTriggerRegistry,nfcLocationsParser,nfcTagsParser,stateLocationsParser}}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,ResolverRegistry}.mjs`
- **Application (dispatcher + actions):** `backend/src/3_applications/trigger/{TriggerDispatchService,actionHandlers}.mjs`
- **API router:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Bootstrap wiring:** `createTriggerApiRouter` in `backend/src/0_system/bootstrap.mjs`
- **Tests:** `tests/isolated/{adapter,domain,application}/trigger/`

## See also

- [`events.md`](./events.md) — runtime event lifecycle and screen integration recipes
- [`../trigger-endpoint.md`](../trigger-endpoint.md) — HTTP contract and ESP32 firmware contract
