# WakeAndLoadService Step 4b power re-check is dead code

**Found:** 2026-07-20, while fixing casting to self-powered panels.
**Status:** Documented, not fixed. Deliberately out of scope.

`WakeAndLoadService.mjs:309` guards the "Step 4b — Re-verify TV power" block
(comment at line 304) with `device.hasCapability('power')`. `Device.getCapabilities()`
(`backend/src/3_applications/devices/services/Device.mjs:345-353`) returns only
`deviceControl, osControl, contentControl, volume, audioDevice` — there is no
`power` key, so the guard is always false and the block has never executed.

Every other `hasCapability` call site uses a real key (`'volume'` at
WakeAndLoadService.mjs:233 and `backend/src/4_api/v1/routers/device.mjs:1117`,
`'audioDevice'` at `device.mjs:1154`), so line 309 is the lone typo.

It is doubly dead: line 311 reads `postPreparePower.wasPoweredOff`, which no adapter
in the repo produces. Correcting the guard to `'deviceControl'` would therefore never
take the `restarted: true` branch — it would only add a redundant `powerOn()` round
trip after prepare, carrying livingroom-tv's 80s verify budget
(`powerOnWaitOptions.timeoutMs: 80000` in devices.yml).

**Consequence:** the CEC auto-sleep protection described in the comment at lines
304-308 does not exist. If TVs are observed powering off during a long prepare, this
needs a real fix: correct the guard AND have the device-control adapter emit
`wasPoweredOff`.
