# Media redesign — batch 2 report: PLACE.2b

## Scope

`PLACE.2b` only. `RELY.8a` remains unaccepted.

## RED → GREEN

- **RED:** the new Dock regressions failed because the existing confirmation had no **Return aim to this device** choice and confirmation did not call the shared aim consumer. The three behaviors were absent: default local return, opt-out retention, and cancel preservation.
- **GREEN:** `Start fresh` now confirms the existing local-only reset, explicitly says other screens are not stopped, and offers a checked **Return aim to this device** control. Confirmed default invokes `CastTargetProvider.clearTargets()`; opt-out and Cancel do not.
- **GREEN focused unit command:** `npx vitest run frontend/src/modules/Media/shell/Dock.test.jsx frontend/src/modules/Media/shell/ConfirmDialog.test.jsx frontend/src/modules/Media/cast/DestinationLine.test.jsx frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx` — **33 passed**.
- **GREEN static checks:** `npx playwright test tests/live/flow/media/media-app-aim-journey.runtime.test.mjs --list` lists the existing phone plus new tablet/laptop AC1/AC2 and AC3 command-guarded Start-fresh journeys (5 total); `git diff --check` passed.

## Browser status

No browser GREEN is claimed. The new runtime cases must run from a clean committed candidate build, not the earlier preview. They use ordinary aim selection and intercept non-GET device requests; no physical/device playback writes are permitted.

## Review repair 1

The first review correctly found that the tablet/laptop journey tried to use the mobile-only launcher. Those viewports now use the persistent search input to open the known **Tuttle Twins** collection, then operate the existing browse-header `DestinationLine`. This is the ordinary tablet/desktop path and retains the same no-device-command guard. The runtime file parses with all five cases listed; no product source or unit-tested behavior changed in this repair.

## Review artifact

The exact uncommitted diff is supplied separately to the independent reviewer; no generated patch is versioned in this worktree.
