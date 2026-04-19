# Multi-Printer Support — Design

**Date:** 2026-04-18
**Status:** Implemented 2026-04-18 — merged in 34226a99 + 260048fb

## Problem

`ThermalPrinterAdapter` is hard-wired to a single printer via the `thermal_printer` key in `adapters.yml` and `services.yml`. We now have two physically separate thermal printers:

- **`10.0.0.50`** — existing printer (downstairs)
- **`10.0.0.137`** — new Volcora (upstairs)

Both are functionally identical (both mounted upside-down, both print gratitude cards and fitness receipts). Each has its own physical trigger button that needs a distinct URL. We need to route print jobs by location.

## Decisions

| Question | Decision |
|---|---|
| How to name/select printers | By **location** (`upstairs`, `downstairs`) — arbitrary name map, but that's the semantic |
| Backwards-compat with `thermal_printer` singular | **Clean break** — delete old key, rename to `thermal_printers` |
| URL shape | Domain-owned action, location as trailing path param: `/api/v1/<domain>/<action>/:location?` |
| Missing `:location` in URL | Falls back to printer flagged `default: true` in config |
| Per-printer overrides | Shared `thermal_printer_defaults` block; per-printer entries override |

## Config Shape

**`data/system/config/adapters.yml`:**

```yaml
thermal_printers:
  upstairs:
    host: 10.0.0.137
    port: 9100
  downstairs:
    host: 10.0.0.50
    port: 9100
    default: true

thermal_printer_defaults:
  timeout: 5000
  upsideDown: true
```

**`data/system/config/services.yml`** — mirror the map so each printer has its own `resolveServiceUrl` target:

```yaml
thermal_printers:
  upstairs:
    docker: http://10.0.0.137:9100
    kckern-server: http://10.0.0.137:9100
    kckern-macbook: http://10.0.0.137:9100
  downstairs:
    docker: http://10.0.0.50:9100
    kckern-server: http://10.0.0.50:9100
    kckern-macbook: http://10.0.0.50:9100
```

Old `thermal_printer` (singular) key is deleted from both files.

## Registry

New class `ThermalPrinterRegistry`, lives alongside `ThermalPrinterAdapter.mjs`:

```js
class ThermalPrinterRegistry {
  #printers = new Map();   // name -> ThermalPrinterAdapter
  #defaultName = null;

  register(name, adapter, { isDefault = false } = {})
  get(name)                // throws if unknown
  getDefault()             // throws if no default configured
  resolve(name)            // name ?? default
  has(name)
  list()                   // [{name, host, port, isDefault}]
}
```

`ThermalPrinterAdapter` itself is unchanged — already per-instance. Registry just holds N of them.

`ConfigService` gets `getThermalPrinters()` returning `{ printers: Map, defaultName: string }`.

## API Routes

Pattern: **action-then-location**, location optional.

### `printer.mjs`

| Old | New |
|---|---|
| `GET /printer` (info) | `GET /printer` — lists all configured printers + defaults |
| `GET /printer/ping` | `GET /printer/ping/:location?` |
| `GET /printer/status` | `GET /printer/status/:location?` |
| `POST /printer/text` | `POST /printer/text/:location?` |
| `POST /printer/image` | `POST /printer/image/:location?` |
| `GET /printer/feed-button/on` | `GET /printer/feed-button/on/:location?` |
| `GET /printer/feed-button/off` | `GET /printer/feed-button/off/:location?` |

### `gratitude.mjs`

- `POST /gratitude/print-card` → `POST /gratitude/print-card/:location?`

### `fitness.mjs`

- Whichever endpoint currently prints (via `printerAdapter`) gets `:location?` appended.

### Shared resolver helper

```js
function resolveAdapter(registry, req) {
  const name = req.params.location;
  if (!name) return registry.getDefault();
  if (!registry.has(name)) {
    throw new HttpError(404, `Unknown printer location: ${name}`);
  }
  return registry.get(name);
}
```

One call at the top of each handler. Throws → existing error middleware → clean 404.

## Wire-up (`app.mjs`)

Replaces current lines ~1201–1230:

```js
const adaptersConfig = configService.getSystemConfig('adapters');
const printersConfig = adaptersConfig.thermal_printers || {};
const printerDefaults = adaptersConfig.thermal_printer_defaults || {};

const registry = new ThermalPrinterRegistry();
for (const [name, cfg] of Object.entries(printersConfig)) {
  const adapter = new ThermalPrinterAdapter(
    { ...printerDefaults, ...cfg },
    { logger }
  );
  registry.register(name, adapter, { isDefault: cfg.default === true });
}
```

Then `hardwareAdapters.printerRegistry = registry` (replacing `printerAdapter`).

Routers (`bootstrap.mjs`, `fitness.mjs`, `gratitude.mjs`, `printer.mjs`) receive `printerRegistry` instead of `printerAdapter`.

## Health Check

Current `printer: boolean` field is dropped. Replaced by:

```js
printers: registry.list().map(({ name, host, port, isDefault }) => ({
  name, host, port, isDefault, configured: true
}))
```

Reports **configured** state only — no live connectivity probing.

## Startup Log

```
Registered 2 thermal printers: upstairs (10.0.0.137:9100), downstairs (10.0.0.50:9100, default)
```

## Boot Safety — No Garbage Prints

Port `9100` is raw ESC/POS. Any bytes we write are spooled and printed. The Volcora's HLK-RM04 WiFi bridge is a dumb TCP-to-serial passthrough — it forwards everything. Rules:

1. **No auto-ping at startup.** Registry construction is pure (no sockets). First packet to each printer comes from a real user request only.

2. **Health check reports configured state, not live state.** No automatic probes. Explicit `/printer/ping/:location` required for liveness info.

3. **Rewrite `ping()` to be byte-free.** Current impl uses `escpos-network`'s `Network(host, port).open()` wrapper, which may write ESC @ init on open. Replace with raw `net.createConnection()` → `'connect'` event → immediate `socket.end()`. Zero bytes written — pure TCP handshake test.

4. **`getStatus()` keeps writing DLE EOT bytes.** These are real-time queries and shouldn't print on spec-compliant firmware, but could on cheap modules. Leave as-is with a doc warning: test once per printer model before relying on it.

5. **Startup validation is pure.** Check: names unique, at most one `default: true`, every entry has `host`. Reject at boot if malformed. No sockets.

## Files Affected

| File | Change |
|---|---|
| `data/system/config/adapters.yml` | Drop `thermal_printer`, add `thermal_printers` + `thermal_printer_defaults` |
| `data/system/config/services.yml` | Same treatment |
| `backend/src/0_system/config/ConfigService.mjs` | Add `getThermalPrinters()` |
| `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs` | Rewrite `ping()` to byte-free TCP probe; drop `createThermalPrinterAdapter` factory |
| `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterRegistry.mjs` | **New** |
| `backend/src/1_adapters/hardware/thermal-printer/index.mjs` | Export registry class |
| `backend/src/app.mjs` | Wire-up (~1201–1230), pass-through (~1371, ~1527), health (~1341) |
| `backend/src/0_system/bootstrap.mjs` | Swap `printerAdapter` → `printerRegistry` in pass-through |
| `backend/src/4_api/v1/routers/printer.mjs` | Accept registry, add `:location?` to all routes, add resolver helper |
| `backend/src/4_api/v1/routers/gratitude.mjs` | Accept registry, `:location?` on `print-card` |
| `backend/src/4_api/v1/routers/fitness.mjs` | Accept registry, `:location?` on print endpoint (line ~488) |

## Tests

- Unit: `ThermalPrinterRegistry` — register, get, getDefault (with and without default), has, list, duplicate name rejection, multiple defaults rejection
- Unit: New byte-free `ping()` — mock `net.createConnection`, verify no `write()` calls
- Integration: each router's `:location?` param — correct adapter selected, missing resolves to default, unknown 404s

## Out of Scope

- Dynamic printer discovery (mDNS etc.)
- Runtime config reload (requires Docker restart, consistent with existing config model)
- Per-printer roles/capabilities (all printers are identical; if that changes later, add `role` field then)
- Live health pings in startup / health check (boot safety)
