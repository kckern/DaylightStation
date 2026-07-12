# Trigger Unification — Plan 6 of 6: Unified Observability

> **For agentic workers:** small doc + log-consistency plan.

**Goal:** Complete the observability unification — one source-tagged dispatch surface across all trigger sources.

**Finding:** The substantive unification was already delivered by Plans 1–5 *by construction*: barcode now dispatches through `TriggerDispatchService`, so it logs `trigger.fired` (with `modality: 'barcode'`) and emits `trigger:<location>:<modality>` WS events like every other source; the old `BarcodeScanService` split-vocabulary logs (`barcode.approved`/`denied`/`ack.*`) were deleted in Plan 4. So Plan 6 is minimal.

**Scope:**
1. Rename the two non-marker barcode *ingress* logs in `app.mjs` to the `trigger.ingress.barcode.*` namespace (`barcode.display.on` → `trigger.ingress.barcode.display.on`; `barcode.display.onFailed` → `trigger.ingress.barcode.display.failed`; `barcode.dispatch.failed` → `trigger.ingress.barcode.dispatch.failed`). **Keep** `barcode.pipeline.ready` / `barcode.dispatcher.ready` unchanged — they are documented boot markers used by the deploy-verification procedure (CLAUDE.local.md). **Keep** `barcode_relay.*` (generic relay-adapter telemetry, shared with `food-scale-relay`).
2. Document the unified observability model in `docs/reference/trigger/observability.md` (the SSOT: `trigger.fired` dispatch event, `trigger:<loc>:<modality>` WS shape, response-handler events, and the intentional ingress-namespace exceptions).

**Non-goal:** Renaming `trigger.fired` → `trigger.event.ingested/resolved/dispatched`. Deferred — `trigger.fired` is the established, source-tagged dispatch SSOT; renaming it carries monitoring risk for marginal value, and a multi-event lifecycle split is a larger change than this migration warrants.

**Verification:** `node --check backend/src/app.mjs`; grep confirms no `barcode.approved`/`barcode.denied` dispatch logs remain anywhere in the tree.
