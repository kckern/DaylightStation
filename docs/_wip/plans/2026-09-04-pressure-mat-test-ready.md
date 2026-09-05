# Pressure mat: ready for the next physical test

User-requested milestone: implement and deploy the ESP recovery and Fitness
startup fixes, then hand off a healthy, identifiable system ready for the user's
wall → floor → first-step test. Physical acceptance is deliberately after this
milestone; do not claim that it has already happened.

The product goal tracker currently holds the previous blocked physical-acceptance
goal and refused creation of a replacement unfinished goal. This document records
the newly requested scope without falsely completing the previous goal.

## Scope and invariants

- Extract the actual C++ detector into a hardware-independent unit and exercise
  that same implementation in native tests. Keep ADC smoothing/networking separate.
- Accumulate release recovery from the press minimum so a slow release is not
  permanently rejected by a one-frame gradient gate.
- After a prolonged stable signal, re-arm for a fresh load edge without inventing
  a physical release or incrementing any counter. Occupancy then becomes unknown,
  not a claim that the mat is empty. Static pressure/noise must not repeat counts.
- A resistive mat cannot distinguish a foot from handling that produces the same
  voltage trace. Do not promise otherwise. Mat traffic must never auto-start a
  workout; retain recent first-step traffic only when HR startup corroborates it.
- Preserve live firmware counter baselines across the start boundary, buffer only
  bounded startup activity, and keep historical storage events out of new totals.
- Retain the deployed sidebar order HR → RPM → Step Mat, optional assignment,
  accurate session/resume totals, shared SVG hearts, and unchanged governance.
- Build identifier in device status/telemetry; verify device identity before OTA,
  retain a recoverable previous firmware artifact, and use authenticated delivery.
- Standalone idle gate before uploads, app builds/replacement, and kiosk reload.
  Verify the real kiosk-loaded asset, not only the server's build metadata.

## Verification and handoff

Native detector traces: normal steps, one stomp per press, noise, slow release,
long hold, stale/settled recovery, timing gaps, uptime wrap, and signal drift.
Frontend: startup-step preservation, deduplication, expiry, no mat-only auto-start,
resume, dynamic card insertion below HR/RPM, and existing count/heart regressions.
Post-deploy: exact firmware id, expected boot transition, healthy Wi-Fi/WS/OTA,
stable idle counters, matching normalized API telemetry, loaded kiosk build.
User test: take down mat and lay flat; start the usual HR-tracked workout.
Step once → card at 1 below HR/RPM, step again → 2, stomp once → one additional
step and one stomp; stop → totals remain visible. No calibration or assignment
tap is required. Handling during an already active workout can resemble a step;
for an unambiguous 1 → 2 check, position the mat before starting the workout.

Manufacturer reference: [ASC detection and recovery notes](https://docs.asc.com/usingHAui.html).
The manufacturer documents slow recovery and unit variation; timing/threshold
behavior still needs the user's real physical acceptance, not just synthetic traces.

## Verified implementation (September 4)

- Ten native detector traces pass with address/undefined-behavior sanitizers.
- 524 Vitest cases across 83 Fitness/adapter/API suites pass, plus three
  backend strap-color node:test cases. No failed/skipped tests. The pre-existing
  third-party BPM source-map warning remains unrelated.
- Chromium and Firefox each pass 225 real-component geometry/color/state cases,
  dynamic card insertion and keyboard interaction, with no browser errors.
- Baseline and updated ESP builds pass. Updated flash usage is 969,000 of
  1,310,720 bytes; RAM is 44,956 of 327,680 bytes. Both builds resolve
  WebSockets 2.7.3, ArduinoJson 7.4.3 and Arduino core 2.0.14. The existing
  upstream UART return-value compiler warning appears in both.
- Authenticated OTA succeeded after an idle gate. Device identity matches;
  `firmware_build=mat-recovery-2dbcc5c07ebb`, boot 24 → 25, reset `SW`,
  Wi-Fi/WS connected, OTA enabled. Initial post-boot idle status reports zero
  steps/stomps/transitions and unknown occupancy, not a person standing there.
- Delivered firmware SHA-256:
  `afdabf8b8126b3a4aedc2cd89a74dd18836ee7cf72492a41f339209af352d827`.
  A private rollback artifact rebuilt from baseline `6d9b5eff2` is retained
  in the build host's `daylight-mat-rollback-*` temporary directory;
  SHA-256 `e27299951d3b31adcc438953d72c3cd4fb20f484ce6c39638bcddd1ab1f3009b`.
  This is a rebuilt baseline, not a readback of the previously running flash.
- OTA staged image/uploader files were removed; its staging directory and
  local build directories are private. No credentials rotated, no threshold
  adjustments, no recalibration, and no synthetic telemetry sent to production.

## Deployment and ready-for-test handoff

- App commit `f94ed5f874a27e320043d9588c1859e168321820` merged to main and
  deployed. Production build metadata: September 4, 18:12:47 PDT. Container is
  healthy. Standalone idle gates passed before build, replacement and kiosk
  refresh; an earlier active-video gate was respected until playback stopped.
- At September 5 01:16:53 UTC (September 4 local), actual garage Firefox 154
  logged `fitness-profile-started.entryAsset=/assets/index-bjSQbGiX.js`, exactly
  matching the served page, and created `step_mat` → `garage-step-mat`.
  Its screenshot shows the normal idle Fitness home, not a simulated workout.
- The normalized API confirms the same firmware id, boot 25, unknown occupancy,
  live readings and zero steps/stomps. ESP Wi-Fi/WS/OTA remain healthy; idle
  counters stayed at zero for several minutes across the app restart/reload.
- Public equipment catalog has ten entries and exactly one correct mat binding.
  Removing only the previously recovered mat entry from the parsed live config
  still matches the pre-recovery backup in every other setting. No governance
  requirements or challenges changed.
- Expected WebSocket errors occurred during container replacement, before the
  new client startup. No Fitness errors were observed after that startup in the
  handoff check. Commit gates, including nine composition tests, also passed.

Status: **ready for the user's physical test**. The real wall → floor → footfall
and active-sidebar visual acceptance remain unperformed; automated traces and
an idle screenshot are not substitutes. No further deployment is needed to begin
that test. The older tracker goal remains blocked on physical acceptance; it was
not falsely marked complete to work around the goal-replacement limitation.
