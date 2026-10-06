# PLACE.2b browser reassessment

## Evidence and diagnosis

- The clean preview is alive and still serves `X-Media-Acceptance-Source: accepted-1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`.
- Tablet/laptop did receive the expected live result. The retained DOM snapshot contains `combobox-option-plex:663508`, `value="plex:663508"`, and the visible **Tuttle Twins** container. `result-row-*` is the phone `SearchMode` renderer's contract; persistent tablet/laptop `MediaContentSearch` uses `combobox-option-*`. The failure was a renderer/fixture selector mismatch, not a catalog failure or changed Plex id.
- The desktop option row is the ordinary navigation action. Its nested **Browse into Tuttle Twins** chevron deliberately calls `drill(item)` inside the combobox; only selecting the option calls `onChange` and pushes `BrowseView`. This distinction also explains why the bounded diagnostic run's nested-chevron probe did not reach `browse-dispatch-header`.
- AC3's final locator was impossible by construction: **Close search** unmounts `SearchMode`, the only phone `DestinationLine`. The final page snapshot correctly has only the launcher/settings/home chrome. Reopening search remounts the shared aim display.
- The one guarded diagnostic run confirmed the full phone Office → **This device** journey and Start fresh → reopen search → **This device**, with **Return aim to this device** checked and zero intercepted device commands. It was stopped after the tablet nested-chevron finding; no retry was made.

## Bounded replacement browser plan

1. Keep the existing non-GET and `/load` device-command guard and assert its capture remains empty.
2. Phone AC1/AC2: open Search, set Office, choose **This device**, assert the visible destination changes immediately, then reopen the sheet and assert `picker-this-device[aria-pressed=true]`.
3. Tablet/laptop AC1/AC2: type a benign query in the persistent search, locate the first visible `role=option` with `data-container=true`, and click that option itself (never a fixed `result-row-*` id or the nested drill/play controls). In the resulting real browse header, perform the same Office → **This device** assertions. A container result is unavoidable because wide layouts mount `DestinationLine` only in a container `BrowseView`; there is no direct wide destination picker to substitute.
4. AC3: use the phone path to set Office, close Search, open **Start fresh**, assert the checked offer and local-only copy, confirm, reopen Search through the visible launcher, and assert **This device** plus the empty command capture.

## Product verdict

No PLACE.2b product bug is evidenced. The shared aim mutations worked in unit coverage and in the focused phone browser path. Both reported browser failures are test-route defects: a phone-only test-id applied to the desktop renderer and an assertion against a deliberately unmounted surface.
