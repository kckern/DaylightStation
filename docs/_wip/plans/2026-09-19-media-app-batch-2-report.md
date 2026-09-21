# Media redesign — batch 2 report: PLACE.2b

## Scope

`PLACE.2b` only. `RELY.8a` remains unaccepted.

## RED → GREEN

- **RED:** the new Dock regressions failed because the existing confirmation had no **Return aim to this device** choice and confirmation did not call the shared aim consumer. The three behaviors were absent: default local return, opt-out retention, and cancel preservation.
- **GREEN:** `Start fresh` now confirms the existing local-only reset, explicitly says other screens are not stopped, and offers a checked **Return aim to this device** control. Confirmed default invokes `CastTargetProvider.clearTargets()`; opt-out and Cancel do not.
- **GREEN focused unit command:** `npx vitest run frontend/src/modules/Media/shell/Dock.test.jsx frontend/src/modules/Media/shell/ConfirmDialog.test.jsx frontend/src/modules/Media/cast/DestinationLine.test.jsx frontend/src/modules/Media/cast/DispatchTargetPicker.test.jsx` — **33 passed**.
- **GREEN static checks:** `npx playwright test tests/live/flow/media/media-app-aim-journey.runtime.test.mjs --list` lists the existing phone plus new tablet/laptop AC1/AC2 and AC3 command-guarded Start-fresh journeys (5 total); `git diff --check` passed.

## Browser status

At the time this section was written, no browser GREEN was claimed; the clean-preview matrix was still pending. That status was superseded by the final repaired-matrix result below, which passed all five cases against the verified preview. The runtime journeys use ordinary aim selection and intercept non-GET device requests; no physical/device playback writes are permitted.

## Review repair 1

The first review correctly found that the tablet/laptop journey tried to use the mobile-only launcher. Those viewports now use the persistent search input to open the known **Tuttle Twins** collection, then operate the existing browse-header `DestinationLine`. This is the ordinary tablet/desktop path and retains the same no-device-command guard. The runtime file parses with all five cases listed; no product source or unit-tested behavior changed in this repair.

## Clean-preview browser attempt and repair 2

Commit `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd` was built from a clean detached checkout; the preview provenance and `X-Media-Acceptance-Source` header both named that exact SHA. The serial five-case matrix began successfully, but the tablet/laptop cases used a nonexistent persistent-search test id despite the visible field, and the phone Start-fresh case tried to click Settings while the modal search surface correctly intercepted it. This was a test-path defect, not a product assertion failure. Repair 2 changed only the runtime selectors: role/name for the persistent field and an ordinary **Close search** before Settings. At that stage the corrected matrix had not yet passed; the final repaired-matrix result below supersedes that status.

## Final repaired-matrix result

After the Sol reassessment, the wide-layout path now clicks the visible top-level `combobox-option-plex:663508` option, and AC3 reopens Search via the ordinary launcher before reading the destination line. The five-case matrix passed serially against the same preview; its response header was `X-Media-Acceptance-Source: accepted-1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`. Command: `BASE_URL=http://127.0.0.1:42167 npx playwright test tests/live/flow/media/media-app-aim-journey.runtime.test.mjs --workers=1 --reporter=line` — **5 passed (21.2s)**. Raw output: `/tmp/media-aim-reassessment-fixed-matrix.log`. `git diff --check` passed. The uncommitted test/report diff is at `/tmp/media-aim-reassessment-fix.diff` for independent review; no product code changed.

## Review artifact

The exact uncommitted diff is supplied separately to the independent reviewer; no generated patch is versioned in this worktree.
