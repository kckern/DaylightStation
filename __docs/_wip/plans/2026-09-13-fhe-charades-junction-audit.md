# FHE Charades junction audit — 2026-09-13

Deployed source: `527b494ea4b3b313ab1441024698bfde32df42fa` (includes current piano work). Build: 09:58:22 PDT. Target: https://daylightlocal.kckern.net/screens/living-room/fhe.

The actual HTTPS Playwright test passed in 3.7 minutes: `tests/live/flow/gaming/fhe-charades.runtime.test.mjs`. It uses native keyboard events and real backend requests, image responses, Plex queue resolution and browser Audio playback. It does not mock the game or media services.

| Junction | Observed evidence |
|---|---|
| FHE route → menu → app registry → definition | Remote launches the exact `charades:family` preset; initial Back returns to selected Charades menu item; reopening works. |
| Profile → setup → session | Six household identities, individually selectable; correct casual settings reach authoritative session. |
| Definition → external bank → pinned media | 36 compiled choices; six SVG sources served successfully with byte-pinned URLs. Loader tests cover edits, deletion, containment and archival stability. |
| Schedule → selector → performer | All 18 wheel winners match server state; each person appears once per round and three times overall. |
| Performer → clue → presenter | User_4/User_5 receive six unique images; others receive twelve unique text clues; no cross-pool assignment. All six masks load in the deployed UI. |
| Remote → action ownership | Arrow/Enter/Escape navigate setup, play and results. Held Enter does not double advance. Real GamepadAdapter compatibility and parent ownership also have integration regressions. |
| Reading → Go → guessing | 61-second reading wait changes neither phase nor timer and plays no music. Fresh OK starts the server deadline and real audio. |
| Configured music → queue → Audio | Config source resolves 28 tracks; separate live probe decoded every track. During all 18 turns, actual audio time advances in guessing and pauses at reveal. |
| Guessing → timeout/reveal | Real 60-second expiry advances; manual finish also works. Image turns reveal the clear pinned picture after guessing. |
| Refresh → resumed session | Mid-guess refresh preserves session, clue and deadline, and restarts phase-appropriate music. |
| Reveal → next turn → complete | Exactly 18 turns; result has completed outcome and empty scores; no rankings or winner UI. |
| Results → FHE → reload | Exit after a refreshed game reconstructs FHE; subsequent reload retains FHE with no session query. Independent completed-session repro also passes. |
| Browser/layout/HTTP | No browser page errors or failed Gaming HTTP requests. Controls, words, decoder and revealed images fit 960×540. |
| Source → production | Successful image build, clear deploy gates before and after build, deployed HTTPS build identity checked before and after full run. Four external configuration files match reviewed payloads. |

## Boundaries of verification

Keyboard events model the Shield remote's D-pad and OK/Back buttons; the physical Shield remote itself was not operated remotely. All six image decoders were visually inspected in normal and simulated red-channel browser captures. Physical red-card contrast on the actual television remains unverified.

Configured tonight: three rounds, one clue per turn, 60 seconds, no competition; guessing music source and image participants live in YAML. Multi-clue shared-time and competitive compatibility are covered by focused tests, not tonight's one-clue live run.

## Regression evidence

The first full run completed all 18 turns but exposed a final return bug after refresh: the URL said FHE while the underlying menu was TVApp. Commit `8e6e6e0c5` reconstructs the originating screen for direct-route sessions while preserving in-memory menu exits. Its regression was red before the fix and ten focused tests passed afterward. The complete live rerun passes the formerly failing return and all earlier junctions.

Implementation review reports and local screenshots/logs/config backups are preserved under `.superpowers/evidence/fhe-charades-2026-09-13/`. Focused verification also passed 239 frontend tests and 144 backend gaming tests during implementation; final source change passed ten targeted tests and all commit gates.
