# Ordinary aimed Play/Add — implementation report

Budget before/after: **5% / 7%**. No build, commit, deployment, full suite, browser journey, or physical-device command ran.

Behavioral REDs proved three defects: ordinary aimed Add reached the real adapter as `play-now`; the screen receiver ignored `op:add`; and it emitted `ok:true` on ActionBus receipt. The focused GREEN now carries `op:add`, appends only in the foreground Player owner, preserves current content/playback revision, increments queue revision, and sends success only after the appended item appears in the owner snapshot. An idle generic screen returns `QUEUE_OWNER_UNAVAILABLE` instead of mounting/autoplaying; the Media app's existing local controller remains the genuine idle-held queue owner.

Changed receiver/product files: `frontend/src/modules/Media/cast/dispatchUrl.js`, `frontend/src/modules/Player/Player.jsx`, `frontend/src/modules/Player/hooks/useQueueController.js`, `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, `frontend/src/screen-framework/publishers/useCommandAckPublisher.js`.

Changed sender/outcome files: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs`, `backend/src/5_composition/bootstrap.mjs`, `backend/src/app.mjs`, `frontend/src/modules/Media/cast/DispatchProvider.jsx`, `frontend/src/modules/Media/cast/dispatchReducer.js`, `frontend/src/modules/Media/cast/dispatchRowPhase.js`, `frontend/src/modules/Media/cast/DispatchProgressTray.jsx`.

Changed tests: `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs`, `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs`, `frontend/src/modules/Player/Player.queueOpOwnership.test.jsx`, `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`, `frontend/src/screen-framework/publishers/useCommandAckPublisher.test.jsx`, `frontend/src/modules/Media/cast/DispatchProgressTray.test.jsx`.

Focused verification (single affected aggregate): **8 files, 116 tests passed**. It covers URL→load→real adapter `op:add`, foreground-owner append/revisions, receipt-false-proof/applied ack, rejection of global content-only playback, target command-ack plus post-command session/owner state for Play, same-owner queue-only revision for Add, and “Added…” tray copy. `git diff --check` is clean.

Remaining acceptance gap: idle generic screen-framework Add has no durable queue owner, so it truthfully returns `QUEUE_OWNER_UNAVAILABLE`; only the existing Media local owner currently provides idle-held Add. The real two-page ordinary UI/native Play/Add journey remains required before accepting `PLACE.2a/AC6` or `RELY.1a–3a`; tests here prove the binding and correlation logic, not actual browser/native story acceptance.

## Repair cycle 1

Independent review found that the first packet proved the adapter envelope but not the cold URL receiver: `parseAutoplayParams` still mapped `queue=<id>&op=add` to legacy `media:queue`, the URL/FKB load path never waited for its receiver ack, and Player reset shader before Add.

The repair routes correlated cold `play` and `queue+op=add` URLs through `media:queue-op`, carries `dispatchId` as `commandId`, reuses that correlator in `WebSocketContentAdapter`, arms the URL ack wait before `loadContent`, and gates the same target-state outcome observer with that ack. Add now returns through append before any play/play-next shader handling, preserving shader and adding exactly one queue revision with no playback revision.

Focused repair verification: `frontend/src/lib/parseAutoplayParams.test.js`, `frontend/src/modules/Player/Player.queueOpOwnership.test.jsx`, `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs`, and `tests/isolated/application/devices/WakeAndLoadService.op.test.mjs` — **4 files, 24 tests passed**; `git diff --check` clean. Budget after repair: **8%**. This establishes parser/route and correlation behavior, not the pending real browser/native acceptance.

## Repair cycle 2

Follow-up review found the correlator was still absent at the real boundary: `DeviceContentDispatchService` correctly lifts `dispatchId` into `execute` options, so the receiver `contentQuery` did not contain it. It also found the 4-second URL waiter expired before the existing 3s+2s WS fallback delay and fallback never recorded an ack result.

The final repair preserves the application boundary (dispatch ID remains outside content resolution) and restores `dispatchId` only in `WakeAndLoadService`'s receiver delivery query. That lets the real URL parser and `WebSocketContentAdapter` use the same command ID. A single 15-second correlated waiter is armed before URL load, survives the delayed fallback, and both direct URL success and fallback record its result before receiver-state outcome matching.

Focused cycle-2 verification: real `DeviceContentDispatchService` → `WakeAndLoadService` → receiver query exercised through both `parseAutoplayParams` and `WebSocketContentAdapter`; direct cold Add and URL-failure→delayed-WS-fallback both accept the matching ack and subsequent owner state. `WakeAndLoadService.watchdog`, `WakeAndLoadService.op`, `device.load-dispatch-correlation`, and `parseAutoplayParams` — **4 files, 24 tests passed**; `git diff --check` clean; budget **8%**. No third repair cycle is planned.
