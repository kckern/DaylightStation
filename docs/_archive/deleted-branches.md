# Deleted Branches

Branches deleted after merge. Recorded here for potential restoration.

To restore: `git checkout -b branch-name <commit-hash>`

| Date | Branch | Commit | Description |
|------|--------|--------|-------------|
| 2026-01-29 | refactor/ddd-migration | c4d71d55 | DDD architecture refactor - merged to main |
| 2026-02-03 | feature/display-name-resolver | ad2e1cba | DisplayNameResolver SSOT module - merged to main |
| 2026-02-03 | feature/governance-test-refactor | 8c6ba47d | Fix skipped governance tests - merged to main |
| 2026-02-06 | save/2026-02-06-plex-token | 1efa08dd | Singalong/readalong rename and Plex token adjustments |
| 2026-03-05 | feature/media-three-panel-redesign | c80b568b | MediaApp three-panel responsive redesign - merged to main |
| 2026-03-05 | worktree-agent-a680a2e5 | 086d9327 | Temporary worktree agent branch (tip = main) - merged |
| 2026-03-05 | origin/fix/firefox-dash-seeking-death-loop | 08c74b9e | Firefox DASH seeking recovery fixes - merged to main |
| 2026-03-05 | feat/media-ux-remediation | 0c0d7241 | 35-fix UX remediation from media player design audit - merged to main |
| 2026-03-06 | fix/session-data-loss | e82baca6 | Fix fitness session data loss on HR device disconnect - merged to main |
| 2026-04-18 | feature/multi-printer-support | 070a5da7 | Multi-printer support (upstairs + downstairs) with byte-free ping - merged to main |
| 2026-04-20 | feature/fitness-frd-q2 | f11d483e | FRD Q2 implementation (10 items: voice memos, settings UI, governance, date fmt, end-session, challenge, user cards, hysteresis) - merged to main |
| 2026-04-23 | backend-refactor | 73f18f37d | Secondary API (port 3119) toggle support - merged to main |
| 2026-04-25 | fix/trigger-sequence-2026-04-25 | 596282945 | NFC→playback trigger fixes (F1/F2/F3/F5: ack-publisher gate split, menu-suppression gate, FKB camera-skip, async URL verify) - merged to main |
| 2026-04-26 | fix/test-suite-greening | fe2adceef | Test-suite greening — drove all 3 vitest suites to 0 failures (731 → 0 across 45 commits). Split: Phase 1 infra (jest-dom config, localStorage polyfill, jsdom downgrade, package.json imports), Phase 2 backend domain (MediaProgress.toJSON + bookmark/completedAt round-trip, YamlMediaProgressMemory persistence), Phase 3 trivial fixes (registry count, manifest displayName, InputManager null-config), Phase 4 component logic (Tetris BOARD_COLS=10 + matching SCSS, NavProvider URL test isolation), Phase 5 PiP overlay slot (gated screen:overlay-mounted preserved), Phase 6 forensic (codemod @jest/globals→vitest across 281 files, mock-export alignment, contract drift fixups, MediaAdapter.resolvePlayables real bug fix) - merged to main |
| 2026-04-23 | feat/fitness-deprioritized-labels | 8fce35a91 | Deprioritize KidsFun in primary-media selection - merged to main |
| 2026-04-23 | feature/media-app-p1 | 113be5be0 | Media P1 — Playwright strict-mode selectors + reset assertion - merged to main |
| 2026-04-23 | feature/media-app-p2 | 814c05ca1 | Media P2 — e2e discovery (search, open detail, play from result) - merged to main |
| 2026-04-23 | feature/media-app-p3 | 99d55f1e4 | Media P3 — e2e fleet (indicator in dock, cards for content devices) - merged to main |
| 2026-04-23 | feature/media-app-p4 | a7a67f65f | Media P4 — e2e cast (pick target, cast a result, progress tray shows it) - merged to main |
| 2026-04-23 | feature/media-app-p5 | 0edad0bd3 | Media P5 — Peek (RemoteSessionAdapter + PeekProvider + PeekPanel) - merged to main |
| 2026-04-23 | feature/media-app-p6 | 44a5250b1 | Media P6 — Session Portability (Take Over + Hand Off) - merged to main |
| 2026-04-23 | feature/media-app-p7 | 9b878c30a | Media P7 — External Control (WebSocket command channel) - merged to main |
| 2026-04-23 | feature/media-ux-improvements | cf6d80435 | Media UX — sync navigation state to URL and history - merged to main |
| 2026-04-23 | feature/nutribot-coaching-redesign | ed5754d82 | Nutribot health-coach — redact implied intake, persist coaching messages - merged to main |
| 2026-04-23 | feature/weekly-review-durable-recording | 44c726392 | Weekly-review — stale-closure drain loop, keyboard nav, lazy recorder logger - merged to main |
| 2026-04-23 | fix/admin-combobox-scroll-stickiness | a0e072361 | Admin-combobox — playwright flow for scroll stickiness - merged to main |
| 2026-04-23 | fix/admin-combobox-title-search | 1c3327f5b | Admin-combobox — playwright flow for hymn title search - merged to main |
| 2026-04-23 | fix/admin-row-thumbnail-loading | ea10773d9 | Admin-row-thumbnail — shimmer visibility during image transition - merged to main |
| 2026-04-23 | refactor/ddd-migration | 955b5b959 | SecretsHandler abstraction design doc - folded into main |
| 2026-04-23 | tick-telemetry | d94db5a45 | Tick rate telemetry for timeline anomaly investigation - folded into main |
| 2026-04-23 | feature/media-redesign | e55574707 | MediaApp three-panel redesign design + plan docs - folded into main |
| 2026-04-23 | feature/per-app-document-titles | 46612c308 | Per-app document title (useDocumentTitle hook + Apps/ wiring) - folded into main |
| 2026-04-25 | feature/secrets-handler | b4dd630dc | SecretsHandler abstraction (ISecretsProvider + Yaml/EncryptedYaml/Vault providers) - merged to main |
| 2026-04-25 | feat/on-deck | 3c1556255 | Unified screen-actions routing for play-now/play-next (already in main) - cleaned up |
| 2026-04-26 | backup/arcade-work-pre-pull | 444854d05 | Pre-pull snapshot of arcadePacker work; same commits already on main (different SHAs) plus main has newer arcadePacker fixes - obsolete, dropped |
| 2026-04-26 | fix/office-program-envelope-migration | 8d3e9c1a0 | Office program envelope migration; every commit subject duplicated on main, no unique work - obsolete, dropped |
| 2026-04-26 | feature/stale-session-recovery | 31785c43f | Stale-session recovery; every commit subject duplicated on main, no unique work - obsolete, dropped |
| 2026-04-26 | fix/shield-wake-and-load-reliability | 1cd0dbdeb | Only unique commit was a merge of fix/office-program-envelope-migration (also redundant); main has 38852 more lines - obsolete, dropped |
| 2026-04-26 | feature/ble-heart-rate | 24585e435 | BLE HR scan/decoder/simulator; main has same work integrated under different SHAs plus 'clear BlueZ GATT cache' fix from 2026-03-09 (branch tip 2026-03-08) - obsolete, dropped |
| 2026-04-26 | feature/nutribot-date-bulletproof | 92f855883 | deriveLogDate helper, date-integrity datastore guard, AI revision date pinning, regression tests - 11 unique commits cherry-picked clean to main, 41/41 tests pass |
| 2026-04-26 | fix/audio-nudge-loop | a840c3cd2 | stallStartPlayhead tracking + isRealProgress + extracted stallPipeline helpers (2026-04-19); user judged this a red herring and pivoted to main's softReinit/decoder_reset/buffered-range approach captured in WIP plan added 4h later - dropped, no merge |
| 2026-04-26 | origin/feature/media-ux-improvements | 697e9569a | Remote-only; ancestor of main, 0 unique commits - deleted from remote |
| 2026-04-26 | origin/feature/nutribot-coaching-redesign | bc3d73b5f | Remote-only; ancestor of main, 0 unique commits - deleted from remote |
| 2026-04-26 | origin/feature/content-format-plugins | e2e50177f | Remote-only; 1 unique commit (Todoist REST v2/Sync v9 → API v1 migration) cherry-picked to main as b68cb846b - deleted from remote |
| 2026-04-26 | feat/cycle-challenge | 0a28ada16 | Cycle challenge feature (CycleChallengeOverlay in FitnessPlayer, RPM pill, fitness-sim cadence/RPM controls, governance docs) - fully merged to main, branch tip == merge-base, local cleanup |
| 2026-04-26 | feature/media-ux-improvements (local) | 697e9569a | Already recorded above (row 31 / row 50) as remote-deleted; local ref persisted. Verified ancestor of main, same SHA. Local cleanup. |
| 2026-04-26 | feature/nutribot-coaching-redesign (local) | bc3d73b5f | Already recorded above (row 32 / row 51) as remote-deleted; local ref persisted. Verified ancestor of main, same SHA. Local cleanup. |
| 2026-04-26 | feature/content-format-plugins (local) | e2e50177f | Already recorded above (row 52) as remote-deleted with cherry-pick to main b68cb846b; local ref persisted. Patch content verified identical. Local cleanup. |
| 2026-04-26 | feat/home-dashboard | 5538835e1 | HomeDashboard — HomeAutomationContainer, /api/v1/home-dashboard router (state/config/scene/toggle/history endpoints), useHomeDashboard hook, ClimateReadout + LightRow components, full TimeSeriesDownsampler, IHomeAutomationGateway with batch getStates/getHistory. Merged to main via 7ea79f86c (no-ff merge commit) - branch deleted. |
| 2026-04-26 | feature/content-format-plugins | e2e50177f | Same as row 52 — force-deleted with -D since cherry-pick to b68cb846b doesn't satisfy git's strict-merge check. Patch byte-identical (verified). |
| 2026-04-28 | feat/weekly-review-ux | 98cc8fbcf | Weekly review UX hardening — fully merged into main; worktree at .worktrees/weekly-review-ux removed. Zero unique commits at deletion time (verified ancestor of main). |
| 2026-04-30 | feature/season-as-show | 0f7b68925 | Season-as-show feature — surface a single Plex season as a standalone tile in FitnessMenu, mirroring the playlist-as-show pattern. PlexAdapter.getContainerInfo exposes rating/parentRatingKey, list router wraps seasons (sourceType:'season'), FitnessPlayableService inherits labels from parent show. Plus cli/plex.cli.mjs rewrite (self-contained, set/set-from-yaml commands) and 15 Super Blocks seasons renamed in Plex via the new tooling. Fast-forwarded into main. |
| 2026-04-30 | worktree-cycle-challenge-sim-fix | 7b99996dc | Cycle-challenge simulator fix — closes 4 P0 integration breaks (catalog never set, no getEquipmentCatalog getter, cycle fields missing from window.__fitnessGovernance, engine→popout sim-state-change bridge missing) plus P1-2 (specific rejection reasons). Bonus: equipmentCadenceMap pulse-timer race fix. Includes Playwright lifecycle test as exit criterion (passes in ~2 min). Fast-forward merged to main; worktree removed. |
