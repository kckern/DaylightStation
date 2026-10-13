# Unknown NFC Tag Capture — Design

**Date:** 2026-04-26
**Status:** Design — pending user review
**Touches:** `__backend/src/1_adapters/trigger/`, `__backend/src/3_applications/trigger/TriggerDispatchService.mjs`, `__backend/src/4_api/v1/routers/trigger.mjs`, `data/household/config/triggers/nfc/`, HA `_includes/automations/`, HA `_includes/rest_commands/`, `__docs/reference/trigger/`

---

## Problem

Today, scanning an unregistered NFC tag returns `404 TRIGGER_NOT_REGISTERED` and broadcasts a `registered: false` event. The tag UID is **not persisted anywhere** — the user has no record of which unknowns they've tapped, and the only way to register one is to manually type the UID into `tags.yml` after reading it from logs or the WS broadcast.

The desired workflow:

1. User taps a brand-new tag at a reader.
2. Backend persists a placeholder for the UID in `tags.yml`.
3. Backend triggers an HA mobile-app push notification with an inline text-reply action.
4. User types a freeform name (e.g., "kids favorite movie") and submits.
5. Backend stores that text as `note:` on the tag entry.
6. Later, user opens `tags.yml`, sees a list of recently-scanned-and-named placeholder tags, and promotes them to real entries by adding `plex:` / `scene:` / etc.

This enables rapid-fire onboarding: tap a stack of unknown tags, label each one as you go, then promote them in bulk later from a real keyboard.

---

## Lifecycle

A tag's state is **derived from its YAML fields**, not stored as an explicit flag:

| State | YAML shape | Behavior on scan |
|---|---|---|
| 0 — never seen | (no entry) | Create placeholder, notify (if configured), broadcast |
| 1 — placeholder, no reply yet | `{ scanned_at: "..." }` | Notify (if configured), broadcast — no YAML write |
| 2 — reply received, awaiting promotion | `{ scanned_at: "...", note: "..." }` | Silent — broadcast still fires for observers |
| 3 — promoted (real tag) | `{ plex: 12345, ... }` | Normal dispatch — never enters this flow |

State 3 is detected by `NfcResolver.resolve(...)` returning a non-null intent, which routes through the existing dispatch path. The unknown-tag handler only runs when the resolver returns `null`.

State 2's behavior is "silent" because the user has already given the tag a name; re-notifying would be noise. The user's next step is to promote it via YAML edit.

**Re-scan in state 1** re-fires the notification on every physical tap (subject to the existing 3s debounce). This is intentional: if the user dismissed or missed the first notification, the next tap re-summons it.

**Note overwriting**: PUT-ing a note to an entry that already has one overwrites it. Re-naming a placeholder is supported by re-tapping the tag and typing a new reply. Last write wins.

---

## Schema

### `data/household/config/triggers/nfc/locations.yml`

Add one optional reserved field per location:

```yaml
livingroom:
  target: livingroom-tv
  action: play-next
  notify_unknown: mobile_app_kc_phone   # NEW (optional)
```

- **`notify_unknown`** (optional, string or null) — the HA notify service name. Backend calls `haGateway.callService('notify', <value>, { ... })`. Omit/null = no notification (placeholder still gets written; broadcast still fires).
- The string is treated opaquely. If the HA service doesn't exist, the call fails and is logged; the trigger flow does not error to the GET caller.

### `data/household/config/triggers/nfc/tags.yml`

Two new optional fields, both ignored by `NfcResolver` (they don't appear in `RESERVED_KEYS` and don't match any content-resolver prefix):

| Field | Type | Set by | Updated? |
|---|---|---|---|
| `scanned_at` | quoted string `"YYYY-MM-DD HH:MM:SS"` (container local time) | Backend on first-scan placeholder write | Never updated after creation |
| `note` | string | PUT endpoint | Overwritten on each PUT |

**Format choice for `scanned_at`**: human-readable, always quoted to prevent YAML auto-parsing into a date object. Round-trips as a string.

**No `pending:` flag.** Lifecycle is entirely field-derived (see table above). Promotion is "add a real intent field"; demotion is "remove the intent field."

Per-reader override blocks (`<reader-id>: { ... }`) are unaffected. They live alongside `note:` and `scanned_at:` at the tag's top level.

---

## Backend Changes

### Adapter: `YamlTriggerConfigRepository.mjs` — add write methods

Currently read-only at boot. Extend with:

- `upsertNfcPlaceholder(uid, { scannedAt })` — if entry doesn't exist, create with `{ scanned_at }`. If it exists, no-op (does NOT update `scanned_at`).
- `setNfcNote(uid, note)` — idempotent upsert: write `{ note }` (and `scanned_at` if missing) into the entry.

Both methods:
1. Acquire the in-memory tag entry, mutate it.
2. Re-serialize the full `tags.yml` to disk via the YAML library already in use.
3. Preserve the order of existing entries and any per-reader override blocks.

**Concurrency:** writes are serialized through a single in-memory mutex (Promise chain) inside the repository instance. Two near-simultaneous scans of two different unknown tags will queue, not race. Read access during a write returns the pre-write state (acceptable — the next scan picks up the post-write state).

### Adapter parsers

- `nfcLocationsParser.mjs`: add `notify_unknown` to the recognized reserved keys; pass through as a top-level field on the parsed location config.
- `nfcTagsParser.mjs`: no parsing-rule changes. `scanned_at` and `note` flow through as ordinary scalar tag-global fields.

### Application: `TriggerDispatchService.mjs` — extend the unknown branch

Current code (lines 131–135):

```javascript
if (!intent) {
  this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
  this.#emit(location, modality, baseLog);
  return { ok: false, code: 'TRIGGER_NOT_REGISTERED', ... };
}
```

New behavior — only when `modality === 'nfc'` (the only modality that has tag-shaped placeholders today):

```javascript
if (!intent) {
  if (modality === 'nfc') {
    await this.#handleUnknownNfc(location, normalizedValue, locationConfig);
  }
  this.#logger.info?.('trigger.fired', { ...baseLog, error: 'trigger-not-registered' });
  this.#emit(location, modality, baseLog);
  this.#recentDispatches.set(debounceKey, this.#clock());   // ← NEW: extend debounce to unknown branch
  return { ok: false, code: 'TRIGGER_NOT_REGISTERED', ... };
}
```

The new `#handleUnknownNfc(location, uid, locationConfig)` private method:

1. Reads current entry from in-memory tag registry: `entry = this.#config.nfc.tags[uid]`.
2. Classifies state:
   - `entry == null` → state 0 → call `repo.upsertNfcPlaceholder(uid, { scannedAt: <now-formatted> })` → set state to 1.
   - `entry?.note` is non-empty → state 2 → return early (no notify, no write).
   - else → state 1 → fall through to notify.
3. If `locationConfig.notify_unknown` is set, builds the notify payload (see below) and calls `haGateway.callService('notify', <svc>, payload)`. Wraps in try/catch; logs failure but does not throw.

**Notify payload** (built server-side):

```javascript
{
  title: `Unknown NFC tag at ${location}`,
  message: `Tap to name tag ${uid}`,
  data: {
    actions: [{
      action: `NFC_REPLY|${location}|${uid}`,
      title: 'Submit',
      behavior: 'textInput',
      textInputButtonTitle: 'Save',
      textInputPlaceholder: 'Tag name',
    }],
  },
}
```

The action ID encodes location + UID so the HA REPLY automation is stateless (see [HA Changes](#ha-changes)).

**Debounce extension:** the existing `recentDispatches` map gets a `.set()` call on the unknown branch too (currently only set on dispatch success). This collapses HA's 2–3 duplicate `tag_scanned` events per physical tap into a single notification. Same key shape (`location:modality:value`), same 3s window.

### API: `trigger.mjs` — add the PUT route

```javascript
router.put('/:location/:type/:value/note', asyncHandler(async (req, res) => {
  const { location, type, value } = req.params;
  const { token } = req.query;
  const { note } = req.body;

  const result = await triggerDispatchService.setNote(location, type, value, note, { token });

  if (result.ok) return res.status(200).json(result);
  const status = STATUS_BY_CODE[result.code] || 500;
  return res.status(status).json(result);
}));
```

`triggerDispatchService.setNote(location, modality, value, note, { token })`:

- Validates modality === 'nfc' (only NFC has notes today). Other modalities → 400 `UNSUPPORTED_MODALITY`.
- Validates location exists. Missing → 404 `LOCATION_NOT_FOUND`.
- Auth-checks via the same `auth_token` field used by GET. Mismatch → 401 `AUTH_FAILED`.
- Validates `note` is a non-empty string ≤ 200 chars (sanity bound). Bad → 400 `INVALID_NOTE`.
- Calls `repo.setNfcNote(uid, note)` (idempotent upsert — creates entry with `scanned_at` if missing).
- Broadcasts `{ topic: trigger:<location>:nfc, type: 'trigger.note_set', location, modality, value, note }` for observer dashboards.
- Returns `{ ok: true, location, modality, value, note }`.

### Bootstrap: no new wiring

`createTriggerApiRouter` in `0_system/bootstrap.mjs` already injects the dispatcher and broadcast. The new PUT route hangs off the same router instance, the new dispatcher method needs `haGateway` and the repository — both already injected.

---

## HA Changes

Two new files in the HA config (managed in `_includes/`):

### `_includes/rest_commands/nfc.yaml` — add a second command

```yaml
nfc_set_note:
  url: http://daylight-station:3111/api/v1/trigger/{{ location }}/nfc/{{ uid }}/note
  method: PUT
  payload: '{"note": {{ note | to_json }}}'
  content_type: 'application/json'
  timeout: 10
```

`{{ note | to_json }}` handles quoting/escaping of the user's freeform text safely.

**Auth note**: The current production `nfc/locations.yml` does not set `auth_token` on any location, so the GET and PUT endpoints both run unauthenticated today. The backend will accept the PUT regardless. If/when an `auth_token` is added to a location, the rest_command should be updated to append `?token=<value>` (HA secret reference). Out-of-scope to wire up token plumbing now.

### `_includes/automations/nfc_unknown_tag_reply.yaml` — new automation

```yaml
id: nfc_unknown_tag_reply
alias: NFC Unknown Tag — Submit Reply
description: When the user submits a name via the iOS Companion REPLY action,
             POST it back to DaylightStation as the tag's note.
mode: parallel
trigger:
  - platform: event
    event_type: mobile_app_notification_action
condition:
  - "{{ trigger.event.data.action.startswith('NFC_REPLY|') }}"
action:
  - variables:
      parts: "{{ trigger.event.data.action.split('|') }}"
      location: "{{ parts[1] }}"
      uid: "{{ parts[2] }}"
      reply: "{{ trigger.event.data.reply_text | default('', true) }}"
  - condition: "{{ reply | length > 0 }}"
  - service: rest_command.nfc_set_note
    data:
      location: "{{ location }}"
      uid: "{{ uid }}"
      note: "{{ reply }}"
  - service: logbook.log
    data:
      name: "NFC"
      message: "Unknown tag {{ uid }} at {{ location }} named: {{ reply }}"
      domain: rest_command
      entity_id: rest_command.nfc_set_note
```

`mode: parallel` so multiple replies in flight don't queue. The action-name parsing is the only state — no helper entities needed.

---

## Error Handling

| Failure | Behavior |
|---|---|
| HA notify call fails (service missing, HA unreachable) | Logged at `error` level. GET response still returns 404 `TRIGGER_NOT_REGISTERED`. Placeholder write still happens. |
| YAML write fails (disk error, permissions) | Logged at `error`. In-memory entry is reverted. GET response includes `placeholder: false`. |
| PUT receives empty `note` | 400 `INVALID_NOTE`. |
| PUT receives note > 200 chars | 400 `INVALID_NOTE`. |
| PUT race: two replies for same UID land simultaneously | Serialized via repo mutex. Last write wins. Both succeed (200). |
| Tag UID in PUT path doesn't exist as placeholder | Idempotent upsert — entry created with `note` + `scanned_at: <now>`. 200. |
| Tag is already promoted (state 3) when PUT arrives | Note is added/overwritten alongside the intent fields. Harmless — `note:` is ignored by the resolver. |

---

## Observability

Existing `trigger.fired` log lines and WS broadcasts continue unchanged. Two new events:

- `trigger.placeholder_created` — log-only (debug). Emitted from `#handleUnknownNfc` after the YAML write.
- `trigger.note_set` — log + WS broadcast. Emitted from `setNote`. Topic: `trigger:<location>:nfc`. Useful for observer dashboards.

Existing `tags.yml` schema doc (`__docs/reference/trigger/schema.md`) gets a new "Unknown tag capture" section explaining the lifecycle table and the `notify_unknown` field.

---

## Testing Plan

Existing trigger tests are in `tests/isolated/{adapter,domain,application}/trigger/`. New coverage:

**Adapter (`YamlTriggerConfigRepository`)**
- `upsertNfcPlaceholder` creates new entry with `scanned_at`.
- `upsertNfcPlaceholder` no-ops if entry already exists (does NOT update `scanned_at`).
- `setNfcNote` upserts (creates entry with `scanned_at` if missing).
- `setNfcNote` overwrites existing note.
- Concurrent writes serialize correctly (no lost writes).
- YAML round-trip preserves order, comments-where-possible, and per-reader override blocks.

**Application (`TriggerDispatchService`)**
- State 0 scan: writes placeholder, calls notify (mocked haGateway), returns 404, broadcasts `registered: false`.
- State 0 scan when `notify_unknown` is omitted: writes placeholder, no notify call, returns 404.
- State 1 re-scan within debounce window: no second notify call.
- State 1 re-scan after debounce: second notify call, no second YAML write.
- State 2 scan: no notify, no write, broadcast still fires.
- `setNote` idempotent upsert when entry missing.
- `setNote` overwrites existing note.
- `setNote` rejects modality other than `nfc`.
- `setNote` 401s on bad token; 200s on matching token; 200s on null/no-auth location.
- Notify failure does not break GET response.

**HTTP (`trigger.mjs`)**
- `PUT /:location/nfc/:uid/note` with valid body returns 200.
- `PUT` with empty/missing `note` returns 400.
- `PUT` with bad token returns 401.

No live/integration tests needed for HA side — that's tested manually by tapping a real tag.

---

## Out of Scope

- A web UI for browsing/promoting placeholders. The user has stated they want to do promotion via YAML editing.
- Automatic promotion (e.g., "if a note matches a known Plex title, look up the ID and add `plex:` automatically"). Could be a future enhancement; deliberately not included.
- TTL / expiration of placeholders. They live in `tags.yml` until the user removes them.
- Capture flow for non-NFC modalities. The architecture leaves room (state lifecycle, PUT URL shape are modality-generic) but the implementation only wires NFC.

---

## Files Touched

```
__backend/src/1_adapters/trigger/YamlTriggerConfigRepository.mjs            (extend: + write methods + mutex)
__backend/src/1_adapters/trigger/parsers/nfcLocationsParser.mjs             (extend: notify_unknown reserved key)
__backend/src/3_applications/trigger/TriggerDispatchService.mjs             (extend: handleUnknownNfc branch + setNote)
__backend/src/4_api/v1/routers/trigger.mjs                                  (extend: + PUT /:location/:type/:value/note)
data/household/config/triggers/nfc/locations.yml                          (data: add notify_unknown: per location)
__docs/reference/trigger/schema.md                                          (docs: lifecycle + notify_unknown section)

# Outside the JS repo (HA-side, on Docker host)
/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/rest_commands/nfc.yaml      (extend: + nfc_set_note)
/media/kckern/DockerDrive/Docker/Home/homeassistant/_includes/automations/nfc_unknown_tag_reply.yaml  (new)
```

---

## See Also

- [`__docs/reference/trigger/schema.md`](../../reference/trigger/schema.md) — current trigger config schema
- [`__docs/reference/trigger/events.md`](../../reference/trigger/events.md) — runtime event lifecycle
- [`2026-04-26-trigger-config-modality-architecture.md`](./2026-04-26-trigger-config-modality-architecture.md) — modality architecture this builds on
