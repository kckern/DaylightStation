# Media redesign — batch 2: PLACE.2b local aim recovery

## Scope

Close `PLACE.2b` only:

1. **AC1:** `This device` remains a destination choice on phone, tablet, and laptop.
2. **AC2:** Choosing it immediately updates the shared aim wherever it is displayed.
3. **AC3:** **Start fresh** offers returning the aim to this device.

`RELY.8a` is not accepted by this packet. The existing local session reset remains local: its confirmation explicitly says it does not stop other screens. Cancelling changes nothing; clearing the aim is selected by default but can be opted out of.

## Change and test intent

The existing `CastTargetProvider.clearTargets()` is the single source of truth for local aim. The settings confirmation calls it only after a confirmed Start fresh with the checked default. No remote playback or device command is introduced.

Focused unit regression coverage is in `Dock.test.jsx`: default clear, opt-out retention, and cancellation, with a separate shared-aim consumer. The existing ordinary phone destination journey is extended with tablet/laptop selection-return checks and a Start fresh journey, all with device-command interception. Browser evidence must be rerun from a clean committed snapshot before ledger acceptance.

## Evidence status

Unit GREEN: `npx vitest run frontend/src/modules/Media/shell/Dock.test.jsx frontend/src/modules/Media/shell/ConfirmDialog.test.jsx frontend/src/modules/Media/cast/DestinationLine.test.jsx frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx` — 33 passed.

The browser suite is intentionally not run against the previous preview: it must run only after this batch is committed and built into a clean candidate snapshot. No acceptance-ledger status is changed here.
