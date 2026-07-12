# Trigger Unification — Design

> Unify NFC, barcode, and future signal sources into one `trigger` pipeline: a
> canonical `TriggerEvent` flows through named guard stages, a per-modality
> resolver, and an open response-handler registry. Date: 2026-07-11.

## Problem

Today two near-identical scan pipelines exist side by side:

- **NFC** lives in a mature, modality-generic `trigger` domain. A scan enters as
  `GET /api/v1/trigger/:location/:type/:value`, flows through
  `TriggerDispatchService` (auth token · 30s debounce · HA-guard · unknown-tag
  capture) → `ResolverRegistry` (domain, `nfc`/`state` resolvers) →
  `actionHandlers` (queue/play/play-next/open/clear/scene/ha-service) →
  `WakeAndLoadService`, broadcasting `trigger:<location>:<modality>`.
- **Barcode** lives in a separate, purpose-built `barcode` domain. A scan enters
  over the WS event bus from an ESP32 BLE relay, is parsed by `BarcodePayload`
  (which already delegates content parsing to the shared `ContentExpression`),
  and dispatched by `BarcodeScanService` (gatekeeper policy → screen broadcast →
  content-ack → wake-and-load fallback). Command barcodes route through
  `BarcodeCommandMap` (pause/next/volume/…).

They duplicate the same concept — *an external signal resolves to one of several
responses* — with divergent, drifting implementations (split logging
vocabularies, barcode missing debounce entirely, two content-dispatch code
paths). More signal sources are anticipated (HTTP calls, SMS receipt, keyboard
input, other hardware), so the abstraction must generalize beyond scanning.

## Decision Summary

| Decision | Ruling |
|---|---|
| **Pipeline shape** | Option 1 — one unified pipeline with a shared, open response registry. Modality resolvers stay pluggable; auth/debounce/authorize/dispatch/logging are shared. |
| **Home & naming** | Keep and broaden the existing `trigger` domain. "Trigger" (not "scan") — the pipeline is about *any external signal*, not scanning specifically. Barcode becomes a modality; `2_domains/barcode` is absorbed. |
| **Ingress** | Thin per-transport ingress adapters, each building a canonical `TriggerEvent` and handing it to one transport-agnostic dispatch core. |
| **Guards** | Named stages in fixed order — `authenticate → debounce → authorize` — each with pluggable, per-`(source, location)` implementations. |
| **Response scope** | Build the full union now: `content`, `transport`, `device`, `ha`, plus the net-new `script`/endpoint handler. Registry stays open. |
| **Content posture** | The `content` handler supports both `authoritative` and `optimistic` postures, defaulted per source (`nfc → authoritative`, `barcode → optimistic`), overridable per location/target. |
| **Script safety** | `script` responses reference *named* endpoints declared in config, not inline URLs — keeps secrets out of tag data and URLs out of `3_applications`. |
| **Rollout** | Strangler-fig: build the core additively, fold in barcode, retire the old barcode pipeline after parity is verified, then add `script`. |

## Architecture

```
┌─ INGRESS (thin per-transport adapters) ─────────────────────┐
│  HTTP GET /trigger/:location/:type/:value   (nfc, state)    │
│  WS bus subscriber   (barcode-relay, future scan hardware)  │
│  webhook handler     (sms, http-callback)      ← future     │
│  keyboard / MQTT listener                      ← future     │
└──────────────────────────┬──────────────────────────────────┘
                           │  each builds a canonical
                           ▼
              TriggerEvent { source, location, value, meta }
                           │
                           ▼
   ┌─ TriggerDispatchService (ONE core, 3_applications/trigger) ─┐
   │  1. authenticate   (token | sender-allowlist | none)        │
   │  2. debounce       (per-key window | off)                   │
   │  3. authorize      (gatekeeper strategies | rate-limit)     │
   │  4. resolve        → ResolverRegistry[source] ⇒ Response|null│
   │  5. dispatch       → ResponseRegistry[kind]                 │
   │  6. broadcast + structured log (unified vocabulary)         │
   └───────────────────────────┬─────────────────────────────────┘
                               ▼
        ┌──── ResponseRegistry (pluggable handlers) ────┐
        │  content → wakeAndLoad / screen dispatch      │
        │  transport → screen WS command                │
        │  device → open / clear                        │
        │  ha → scene / ha-service                      │
        │  script → named endpoint / script             │
        └───────────────────────────────────────────────┘
```

### Layer placement (per `docs/reference/core/layers-of-abstraction/`)

| Piece | Layer | Notes |
|---|---|---|
| Ingress adapters | `4_api` (HTTP), bus subscribers / `3_applications/hardware` (WS, MQTT) | Thin; only build a `TriggerEvent` and call the core |
| `TriggerEvent` value object | `2_domains/trigger` | Canonical, transport-agnostic |
| Guard-stage strategies | strategy impls in `2_domains/trigger`; orchestration in `3_applications/trigger` | Named stages, pluggable impls |
| Resolvers (`nfc`/`state`/`barcode`/…) | `2_domains/trigger/services` | Per-modality; `ResolverRegistry` already exists |
| `Response` value object | `2_domains/trigger` (references `ContentExpression` from `content`) | The union type |
| `ResponseRegistry` + handlers | `3_applications/trigger` | Generalizes today's `actionHandlers`; open registry |
| `endpointGateway` port | `3_applications/trigger/ports` | Implemented by an adapter; injected at bootstrap |
| `TriggerDispatchService` | `3_applications/trigger` | Generalized from today's service |

The `content` domain (Level 1) remains the home of `ContentExpression`; the
`trigger → content` import is legal (Decision D6).

## Core Contracts

### TriggerEvent

```js
TriggerEvent {
  source,     // modality: 'nfc' | 'state' | 'barcode' | 'sms' | ...  (HTTP route's :type)
  location,   // origin id: reader/scanner/endpoint ('livingroom', 'garage')
  value,      // raw payload: NFC uid | barcode string | state value | sms body
  meta,       // { device?, timestamp, token?, transport, raw? } — transport-specific extras
}
```

Near-exact generalization of today's `(location, type, value, options)`. Mappings:

- **NFC**: `{ source:'nfc', location:<reader>, value:<uid>, meta:{ token:<query.token>, transport:'http' } }`
- **Barcode**: `{ source:'barcode', location:<scanner/screen>, value:<code>, meta:{ device:'ds2278', timestamp:<ts>, transport:'ws' } }`

### Guard stages

Each stage is a small strategy interface, selected per `(source, location)` from
config. The core runs them in fixed order and short-circuits with today's
structured result codes.

```js
authenticate(event, ctx) → { ok } | { reject: 'AUTH_FAILED' }
    impls:  tokenAuth (nfc)  ·  senderAllowlist (sms)  ·  none (barcode LAN)
debounce(event, ctx)     → { pass } | { debounced, sinceMs }
    impls:  perKeyWindow { windowMs, key=`${location}:${source}:${value}` }  ·  off
authorize(event, ctx)    → { approved } | { denied: reason }
    impls:  gatekeeperStrategies (barcode: autoApprove/policy_group)  ·  rateLimit  ·  none
```

- NFC token check → `authenticate` impl; NFC 30s debounce → `debounce` impl.
- Barcode `BarcodeGatekeeper` + strategy list → `authorize` impl.
- **Barcode gains debounce** (BLE HID can double-fire like HA's `tag_scanned`).
- Any source can opt into any stage.

The existing HA-guard-suppression and unknown-tag capture flows remain
NFC-specific concerns within the dispatch core (invoked around resolve/dispatch),
not generalized stages — they encode NFC-only policy.

### Resolver boundary

Resolvers stay per-modality (opaque-UID lookup vs self-describing parse are
genuinely different) and converge only on their **output type**:

```js
ResolverRegistry.resolve({ source, location, value, registry, contentIdResolver }) → Response | null

  NfcResolver     : registry lookup + defaults/global/override merge + shorthand → Response
  BarcodeResolver : self-describing parse (today's BarcodePayload logic)         → Response
  StateResolver   : state-value lookup                                           → Response
  null            → existing unknown-value capture flow (placeholder + notify)
```

NFC's merge/shorthand/metadata-stripping and barcode's grammar parser are
untouched internally; only their result is normalized to `Response`.

### Response taxonomy

```js
Response =
  | { kind:'content',   target, expression: ContentExpression, end?, posture? }
  | { kind:'transport', target, command, arg? }         // pause · next · volume:30 · speed:1.5
  | { kind:'device',    target, op:'open'|'clear', path?, params? }
  | { kind:'ha',        op:'scene'|'service', scene?, service?, entity?, data? }
  | { kind:'script',    ref, params? }                  // named endpoint/script
```

Legacy-behavior mapping (no behavior lost):

| Today | → Response |
|---|---|
| NFC `queue`/`play`/`play-next` | `content` (verb in `expression`) |
| NFC `open` / `clear` | `device` (`op`) |
| NFC `scene` / `ha-service` | `ha` (`op`) |
| Barcode content scan | `content` |
| Barcode command (`pause`/`volume`/`blackout`…) | `transport` (from `BarcodeCommandMap`) |

### Response handler registry

```js
responseHandlers = {
  content:   (r, deps) => …,   // posture-aware (below)
  transport: (r, deps) => deps.broadcast(r.target, commandMap(r.command, r.arg)),
  device:    (r, deps) => deps.deviceService.get(r.target)[r.op](r.path, r.params),
  ha:        (r, deps) => deps.haGateway.callService(…),
  script:    (r, deps) => deps.endpointGateway.call(r.ref, r.params),
}
dispatchResponse(response, deps) → responseHandlers[response.kind](response, deps)
```

Open registry: a new kind is a new handler entry, no core change.

### Content dispatch posture

The one genuine reconciliation between the two systems. Both postures are kept:

- **authoritative** (NFC default): straight to `wakeAndLoad.execute(target, query)`
  — reliable for a cold/off screen.
- **optimistic** (barcode default): broadcast to the live screen → wait ~2s for
  `content-ack` → fall back to `wakeAndLoad` only if no ack — instant when the
  target screen is already on.

Selected by `Response.posture`, defaulted per source, overridable per
location/target in config. Both become available to any source.

### Script / endpoint handler (net-new)

Config declares *named* endpoints; a Response references one by name:

```yaml
endpoints:
  bedtime_routine: { method: POST, url: "http://localhost:3111/api/v1/…", headers: {…} }
```

```js
{ kind:'script', ref:'bedtime_routine', params:{ … } }  →  endpointGateway.call('bedtime_routine', params)
```

`endpointGateway` is an injected port (internal HTTP or external webhook-out), so
no URL is hard-coded in `3_applications` and no secret lands in tag config.

### Illustrative extension — playback-hub as a response target

This is **not core scope** — it is a worked example of *what the open registry
buys us*, included to validate the abstraction against a concrete future use case:
"a scan plays a specific track on a specific playback-hub audio slot."

The backend already has a clean playback-hub bounded context —
`3_applications/playback-hub/ports/IPlaybackHubGateway.mjs`,
`HttpPlaybackHubAdapter`, the `SendHubCommand` use case, and a `PlayCommand`
value object. So this use case needs **no new hub integration** and **no core
change** — only a new response kind + handler that injects the existing gateway:

```js
{ kind:'playback-hub', target:'red', expression: ContentExpression /* plex:595102 */, posture?, volume?, duration? }
  → responseHandlers['playback-hub'](r, { playbackHubGateway })
      → sendHubCommand.execute(PlayCommand.create({ action:'play', target:r.target, contentId, shuffle, … }))
```

**Why its own kind (not `content`):** `content` is screen-centric — its `target`
is a screen/device in `deviceService` and its postures are screen-ack /
wake-and-load. Playback-hub outputs to audio *slots by color* — a different
target space — so it warrants a dedicated kind.

**Encoding — self-describing vs registry, per modality.** The widened grammar
lets the *target token* select the kind: a target registered as a hub slot →
`playback-hub`; one registered as a screen → `content`. Same grammar, resolver
looks up the target's type.

```
red:plex:595102+shuffle+besteffort
│    │          │        └─ posture hint  → Response.posture = 'best-effort'
│    │          └─ option        → expression.options.shuffle = true
│    └─ source:id (contentId)    → ContentExpression 'plex:595102'
└─ target 'red'  (known hub slot) → kind = 'playback-hub', target = 'red'
```

| | Self-describing (barcode/QR, NFC-NDEF) | Registry lookup (NFC-by-UID) |
|---|---|---|
| Intent lives | On the code | In `tags.yml` |
| Make one | Generate + print, zero config | Write UID → config entry |
| Change it | Reprint the code | Edit config, keep the tag |
| Best for | Disposable/printed, generate-and-go | Reusable physical tags |

Both are supported because resolution is per-modality: barcode/QR parse the
self-describing string; NFC-by-UID looks the expression up in `tags.yml`;
NFC-NDEF (if the reader forwards the NDEF payload rather than the UID) parses it
like a QR code. All three converge on the identical `Response`.

**Deferral — "play when it comes online."** Two distinct offline cases:

- **Device offline, hub up:** handled natively by the hub — `/api/play` arms the
  slot (`armed.json`) and playback starts when the BT device connects. The scan
  just fires the arm; the deferral lives in the hub, which is the right place.
  Supported with no new trigger machinery.
- **Hub itself unreachable:** *not* supported by this design (see non-goals).
  Holding a `Response` until an endpoint is reachable is reliable delivery — an
  orthogonal outbox/retry layer around dispatch, not hub-specific — and is left
  as an explicit future extension.

## Absorbed / retired code

| Existing | Fate |
|---|---|
| `2_domains/barcode/BarcodePayload` | Logic moves into `BarcodeResolver`; output becomes `Response` |
| `2_domains/barcode/BarcodeGatekeeper` + strategies | Becomes the `authorize`-stage impl |
| `2_domains/barcode/BarcodeCommandMap` | Becomes the `transport` handler's vocabulary |
| `3_applications/barcode/BarcodeScanService` | Retired; content/command split → resolve→Response→dispatch |
| `3_applications/hardware/barcodeRelay.mjs` | **Kept** as the barcode ingress adapter (retarget onScan to emit a `TriggerEvent`); day-log persistence unchanged |
| `1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter` | Already dormant; remove or leave inert |

## Rollout (strangler-fig)

1. **Additive core** — introduce `TriggerEvent`, `Response`, `ResponseRegistry`
   (generalize `actionHandlers` → content/device/ha handlers) and guard-stage
   interfaces. Rewire `TriggerDispatchService` to `resolve → Response →
   dispatchResponse`. NFC/state behavior unchanged; existing trigger tests green.
2. **Fold in barcode** — add `BarcodeResolver`, the `transport` handler, and the
   barcode ingress adapter (retarget `barcodeRelay.mjs`). Gatekeeper → `authorize`
   stage; add barcode `debounce`. Route barcode through the unified core.
3. **Retire** `2_domains/barcode` + `BarcodeScanService` once parity is verified.
4. **New capability** — add `script` handler + `endpointGateway` port + named-endpoint config.
5. **Unify** logging vocabulary (`trigger.event.ingested → resolved → dispatched`,
   carrying `source`) and the WS event shape, replacing the split `trigger.fired`
   / `barcode.*` / `barcode_relay.*` namespaces.

## Backward compatibility

- HTTP `GET /trigger/:location/:type/:value` unchanged (already generic).
- Barcode relay firmware + WS message shape unchanged.
- NFC location/tag YAML unchanged.
- Barcode scanner/command config migrates into the trigger registry shape
  (barcode locations/scanners become trigger locations with `source: barcode`).

## Testing

TDD per step. Units tested in isolation:

- Each ingress adapter builds a correct `TriggerEvent`.
- Each guard stage (authenticate/debounce/authorize) in isolation.
- Each resolver (`nfc`/`state`/`barcode`) → correct `Response` or `null`.
- Each response handler; dispatch routing by `kind`.
- Both content postures (authoritative, optimistic + ack timeout → fallback).

**Parity tests:** a golden set of representative NFC scans and barcode scans must
produce equivalent effects (same target, same query/command, same broadcast)
through the unified core before the old barcode pipeline is deleted. Existing
`tests/unit/{barcode,trigger}` suites migrate/extend.

## Non-goals

- Merging the two resolution models (opaque-UID lookup vs self-describing parse)
  into one resolver — they stay separate; only outputs converge.
- Merging authentication with authorization — they are distinct named stages.
- Changing barcode relay firmware, NFC config format, or the public HTTP route.
- Building future ingress sources (SMS/keyboard/MQTT) now — only leaving the
  ingress-adapter slot for them.
- **Reliable delivery / deferred dispatch** (an outbox that persists a `Response`
  and retries until an offline endpoint — e.g. an unreachable playback-hub — comes
  back). This is an orthogonal layer wrapped around dispatch, not baked into any
  handler; left as an explicit future extension. Device-level deferral that a
  downstream system already provides (e.g. the hub's arm-on-connect) is used as-is.
