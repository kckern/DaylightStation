# Trigger Unification — Plan 4 of 6: Retire Dead Barcode/Action Code

> **For agentic workers:** superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Delete the code superseded by the unified pipeline, now that barcode routes through it (Plan 3).

**Architecture:** Pure deletion + dangling-import verification. No behavior change.

## Global Constraints

- **Keep** `2_domains/barcode/BarcodePayload.mjs` and `2_domains/barcode/BarcodeCommandMap.mjs` — they are consumed by `BarcodeResolver` and app.mjs (`resolveCommand`). Do NOT delete them.
- **Keep** `3_applications/hardware/barcodeRelay.mjs` — it is the barcode ingress adapter.
- **Leave** `1_adapters/hardware/mqtt-barcode/MQTTBarcodeAdapter.mjs` dormant — it is entangled with `bootstrap.mjs` (referenced, set null) and harmless; deleting it is out of scope.
- Verified before writing this plan: no live (non-self, non-test) imports of `BarcodeScanService`, `BarcodeGatekeeper`, `autoApprove`, or `actionHandlers`. All `BarcodeScanService` mentions in app.mjs are comments.
- Full trigger + barcode + isolated sweep must stay green after deletion.

## Task 1: Delete superseded modules + verify

**Delete (source + test):**
- `backend/src/3_applications/barcode/BarcodeScanService.mjs` + `tests/isolated/assembly/barcode/BarcodeScanService.test.mjs`
- `backend/src/2_domains/barcode/BarcodeGatekeeper.mjs` + `tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs`
- `backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs` (+ the `strategies/` dir if now empty)
- `backend/src/3_applications/trigger/actionHandlers.mjs` + `tests/isolated/application/trigger/actionHandlers.test.mjs` (if present)

- [ ] **Step 1: Re-confirm no live importers** (belt-and-suspenders before deleting):
```bash
grep -rn "BarcodeScanService\|BarcodeGatekeeper\|AutoApproveStrategy\|autoApprove\|actionHandlers\|dispatchAction\|UnknownActionError" backend/src --include=*.mjs | grep -v "test\|// \|/\*\| \* " | grep "import\|from '"
```
Expected: no matches referencing the deleted modules (only `responseHandlers` for the Unknown*Error family, which is fine). If ANY live import of a to-be-deleted module exists, STOP and report — the deletion is not safe.

Note: `UnknownActionError` is now defined in `mapIntentToResponse.mjs` (not actionHandlers) — confirm the grep's `UnknownActionError` hits are `mapIntentToResponse`/`responseHandlers`, not `actionHandlers`.

- [ ] **Step 2: Delete the files**
```bash
git rm backend/src/3_applications/barcode/BarcodeScanService.mjs \
       backend/src/2_domains/barcode/BarcodeGatekeeper.mjs \
       backend/src/2_domains/barcode/strategies/AutoApproveStrategy.mjs \
       backend/src/3_applications/trigger/actionHandlers.mjs
# tests (use git rm for any that exist; check first with ls):
git rm tests/isolated/assembly/barcode/BarcodeScanService.test.mjs \
       tests/isolated/domain/barcode/BarcodeGatekeeper.test.mjs \
       tests/isolated/application/trigger/actionHandlers.test.mjs 2>/dev/null || true
```
Remove the `backend/src/2_domains/barcode/strategies/` dir if empty, and `backend/src/3_applications/barcode/` if empty.

- [ ] **Step 3: node --check the files that referenced them**
```bash
node --check backend/src/app.mjs && node --check backend/src/3_applications/trigger/TriggerDispatchService.mjs && node --check backend/src/3_applications/hardware/barcodeRelay.mjs
```
Expected: all OK (references were comments/removed imports).

- [ ] **Step 4: Full sweep**
```bash
npx vitest run tests/isolated/domain/trigger tests/isolated/application/trigger tests/isolated/adapter/trigger tests/isolated/adapter/persistence tests/isolated/api/routers/trigger.test.mjs tests/isolated/tooling/migrateTriggerConfig.test.mjs tests/isolated/domain/barcode tests/isolated/assembly/barcode
```
Expected: green. The remaining `tests/isolated/domain/barcode/` (BarcodePayload, BarcodeCommandMap) + `assembly/barcode` (if any survive) still pass. If a deleted test's directory is now empty, that's fine.

- [ ] **Step 5: Commit**
```bash
git commit -m "chore(trigger): retire BarcodeScanService, BarcodeGatekeeper, actionHandlers (superseded by unified pipeline)"
```

## Self-Review
- Deletions match the verified dead set; `BarcodePayload`/`BarcodeCommandMap`/`barcodeRelay`/`MQTTBarcodeAdapter` retained. No behavior change; sweep green.
