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
  # voice and barcode sources live only in sources.yml (see the note below)
```

> **Path drift:** the live tree consolidates reader sources into `data/household/triggers/sources.yml` (one entry per source, each with a `modality:` key) and tag registries into `data/household/triggers/bindings/nfc/*.yml`. The per-modality *shapes* below are what the parsers still consume; only the file layout moved.

Each modality is self-contained. A modality may have:
- A `locations.yml` (always — defines the trigger sources of that modality and their defaults)
- One or more registry/resolver-data files (`tags.yml`, `intents.yml`, etc.)
- A code-only resolver (voice keeps its commands inline on the source; see [Voice sources](#voice-sources))

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
- `learner_action` (optional, string or null) — what a **school learner card** means at this reader; see [Learner cards](#learner-cards) below. Null (or absent) means a learner card is not actionable here.
- `auth_token` (optional, string or null) — required auth token; null = no auth

**Defaults** (everything else, e.g. `shader`, `volume`, `shuffle`, `continuous`) — flow into the load query as the lowest-precedence layer for any tag scanned at this reader.

`learner_action` is reserved rather than a default on purpose: swept into `defaults` it would inherit into every tag scanned at that reader and be forwarded into the load-query string of every book tap.

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

Inside the tag body (and inside any per-reader override block), these keys are consumed as first-class intent fields rather than passing through as load-query params: `action`, `target`, `content`, `scene`, `service`, `entity`, `data`, `school_learner`. (Same `RESERVED_KEYS` set used by the previous `TriggerIntent.resolveIntent`.)

---

## Learner cards

A **learner card** is an NFC tag carrying `school_learner:` — it names a *person*, not a piece of content.

```yaml
# tags
048ba600cc2a81:
  note: user_4 personal card (red)
  school_learner: user_4
```

The card names **who**. The reader decides **what happens to them**, via that location's `learner_action`:

```yaml
study:
  target: portal
  action: play-next
  learner_action: print-agenda      # tap here -> print my agenda

livingroom:
  target: livingroom-tv
  action: play-next
  learner_action: reading-session   # SAME card -> start my reading session
```

**Resolution.** `NfcResolver` treats `school_learner` as an actionable field, resolved **before** content (a learner card carries no content, and shorthand expansion over a reader's defaults could otherwise throw `AMBIGUOUS_SHORTHAND` first):

| Situation | Result |
|---|---|
| Card tapped at a reader with `learner_action` | intent `{ action: <learner_action>, learnerId, location, target, params: {} }` |
| Card tapped at a reader with no `learner_action` | `null` → the ordinary unknown-tag capture, so a mis-tapped card is noticed rather than doing something wrong |
| `school_learner` on the reader's *defaults* | ignored — a learner card must be a TAG, never a property of a room |
| `school_learner` is a list, a map, or empty | `ValidationError(code: 'INVALID_SCHOOL_LEARNER')` — a learner id becomes a URL segment downstream. An unquoted number is accepted and stringified. |

`school_learner` is in `RESERVED_KEYS`, so it never leaks into `params` (and thus never into a load-query string), and it honours the normal precedence chain — a per-reader override block can point the same physical card at a different learner at one reader.

**Dispatch.** The intent becomes `Response.learner` (`mapIntentToResponse` discriminates on the presence of `learnerId`, deliberately *not* on an enumerated action list), which `responseHandlers.learner` routes through an injected `learnerActions` registry.

**An unregistered op is a named refusal, never a fallback.** If `reading-session` has no handler, the tap answers `{ status: 'no_handler', op, learnerId }` and logs `trigger.learner.no_handler` — it does not run `print-agenda` because that happens to be the only learner action wired. A preschooler tapping their card in the living room and hearing a printer start up two rooms away is worse than nothing happening.

Handlers are registered at composition (`backend/src/app.mjs`), so the trigger pipeline holds no School import. `print-agenda` lives in `backend/src/5_composition/modules/learnerCardActions.mjs`; it calls School's `ResolvePersonalCard` and broadcasts `agenda-suppressed` on the `omr` topic when the print cooldown suppresses a repeat tap — that broadcast is the only feedback a tap producing no paper gets, and `useScanCeremony.js` renders it.

**Both ingress doors resolve identically.** An HTTP tap (`POST /api/v1/trigger/<location>/nfc/<uid>`) and a tap arriving on the hardware-relay bus (`nfcTapIngress`, the omr-relay's M5 Unit NFC) both go through `TriggerDispatchService`. `nfcTapIngress` is transport-only — canonicalize the uid, map reader id → location, call `handleEvent` — and holds no tag policy. Its one exception is the shutdown tag, whose uid lives in `shutdown.yml` rather than the tag registry and is checked ahead of everything, including the reader map.

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

**No restart needed to promote.** The registry is read at boot, but an NFC miss re-reads the trigger files once (`YamlTriggerConfigRepository.refreshNfcTags`) and resolves again, so the first tap after a tag is filed into `bindings/nfc/books.yml` plays it. The stub left in `unsorted.yml` is swept on that re-read, the same as at boot. Logged as `trigger.registry.refreshed` (`known`, `added`, `updated`) or `trigger.registry.refresh-failed` (warn).

The re-read is additive: it adds new tags and updates existing ones, but **never removes** one, and a read that throws changes nothing. A file Dropbox is mid-sync on can read as missing without an error, and that must not unregister the house. Two consequences: **removing** a tag still needs a restart, and so does **changing** a tag that already resolves, since a tap that resolves never misses and never triggers the re-read.

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

## Voice sources

```yaml
kitchen-voice:
  modality: voice
  location: kitchen
  target: kitchen-display
  guards: { authenticate: { secret: <token> } }   # set it whenever mode is not off
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
- **Set `guards.authenticate.secret` whenever `routing.mode` is not `off`.** Without it, anyone who can
  reach the endpoint can make the house act on free text, and every such call spends a decision-model
  request. Boot logs `trigger.voice.unauthenticated` (warn) for each voice source in that state.
- Two sources of the same modality at one `location` load, but the later one in the file replaces the
  earlier; boot logs `trigger.config.location.shadowed` (warn) naming both.
- **Modes** (transcripts only; exact keywords always dispatch):
  - `off` — exact keywords only.
  - `confirm` — a model match returns `{confirm: true, proposal: {id, command, description, confidence, expiresInMs}}`
    and dispatches nothing; `POST /trigger/<loc>/voice/confirm {"proposal": "<id>"}` within 120 s dispatches it once.
    With `?dryRun=1` the response carries `dryRun: true` and `proposal.id: null`: nothing is stored, so it cannot be confirmed.
  - `route` — a model match at or above the floor dispatches directly. Promote from `confirm` only on the evidence in
    the log store (`trigger.voice.proposed` vs `trigger.voice.confirmed`, ≥ 30 proposals, ≥ 90 % confirmed).
- The decision is one `choice` over the commands plus `none`, 1.5 s timeout. Anything short of an accepted match →
  `404 VOICE_NO_MATCH` with a `reason`:
  - `low-confidence` — the model picked a command below the floor (logged as `trigger.voice.near_miss`);
  - `none` — the model answered `none`;
  - `outside-options` — the model's answer was missing or not one of the offered ids;
  - `decision-failed` — the model call threw or timed out;
  - `no-decision-model` — no decision gateway is configured (no Jev key);
  - `model-off` — the source's `routing.mode` is `off` and the transcript was not an exact keyword;
  - `no-commands` — the location has no commands to offer (defensive; the parser rejects an empty `commands`).
- The normal 30 s per-(location, modality, value) debounce applies: the same command twice within 30 s dispatches once.
  Voice values are keyword-normalized before debouncing, so `GET …/voice/play%20jazz` and a transcript `"play jazz"`
  count as the same trigger.
- Transcripts are logged to the log store (first 200 characters, on `trigger.voice.match` and
  `trigger.voice.near_miss`) so the floor can be tuned; treat the store as holding what people said.
- Log events: `trigger.voice.match`, `trigger.voice.near_miss`, `trigger.voice.decision_failed`,
  `trigger.voice.no_match`, `trigger.voice.proposed`, `trigger.voice.confirmed`, `trigger.voice.confirm_missed`,
  then the usual `trigger.fired`.

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

To add a modality (voice, below, is the most recent worked example):

1. Create the data dir + files: `data/household/config/triggers/<modality>/locations.yml` (+ any registry files like `intents.yml`).
2. Add a parser at `backend/src/1_adapters/trigger/parsers/<modality>LocationsParser.mjs` (and any registry parsers).
3. Wire the parser into `buildTriggerRegistry` in `backend/src/1_adapters/trigger/parsers/buildTriggerRegistry.mjs`.
4. Add a resolver class at `backend/src/2_domains/trigger/services/<Modality>Resolver.mjs` (PascalCase, with `static resolve(...)`).
5. Register the resolver class in `backend/src/2_domains/trigger/services/ResolverRegistry.mjs` (`resolvers` map).
6. Add the modality to the allowlist in `sourcesParser.mjs` and route it through `perLocation` so one bad source is skipped alone (`trigger.config.entry.skipped`) instead of emptying the registry.

No changes needed to `TriggerDispatchService`, `responseHandlers`, the WebSocket broadcast, or the screen-framework subscription handler. The screen subscription topic (`trigger:<location>:<modality>`) generalizes for free.

---

## Files

- **Adapter (parsers + I/O):** `backend/src/1_adapters/trigger/{YamlTriggerConfigRepository,parsers/{buildTriggerRegistry,sourcesParser,nfcLocationsParser,nfcTagsParser,stateLocationsParser,voiceLocationsParser}}.mjs`
- **Domain (resolvers):** `backend/src/2_domains/trigger/services/{NfcResolver,StateResolver,BarcodeResolver,VoiceResolver,ResolverRegistry}.mjs`
- **Application:** `backend/src/3_applications/trigger/{TriggerDispatchService,mapIntentToResponse,responseHandlers,VoiceCommandMatcher,VoiceTriggerService}.mjs`
- **API router:** `backend/src/4_api/v1/routers/trigger.mjs`
- **Composition:** `backend/src/5_composition/modules/{triggerApi,voiceTrigger}.mjs`
- **Tests:** `tests/isolated/{adapter,domain,application,api}/trigger/` plus colocated `*.test.mjs` for the voice modules

## See also

- [`events.md`](./events.md) — runtime event lifecycle and screen integration recipes
- [`../trigger-endpoint.md`](../trigger-endpoint.md) — HTTP contract and ESP32 firmware contract
