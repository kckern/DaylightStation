# Application module ownership disposition

Milestones 2 and 3 retain the full source census. This is the current ownership and migration record, **not cutover certification**. Milestone 2 is checkpointed at `9f19f9f2f7`; Milestone 3 is still in progress in the isolated `refactor/application-modules` worktree. No deployment or merge into main is represented here.

This snapshot includes the final 447 frontend/shared/satellite moves, 138 CLI moves, configuration policy split, command-entry restorations, and three reviewed prototype retirements. All enumerated ownership transitions are structurally reconciled. Final selected runtime replay and the production frontend build are verified; native calculator artifact acceptance remains incomplete.

## Source universe and provenance

The [original census](2026-10-08-application-modules-m2-m3-census.csv) enumerates 917 groups and 10,225 tracked files at `759be3aaf7`, across `backend/src`, `frontend/src`, `shared`, `cli`, and `_extensions`. The inventory reconstructs those groups from the Git tree and verifies each row count, disjointness, and complete coverage.

The [machine-readable inventory](2026-10-09-application-modules-ownership-inventory.json) embeds 43 reviewed source maps and their input SHA-256 hashes, resolves 8,873 source-to-terminal paths, and preserves historical target revisions. These move records include intermediate paths and sources outside the census; their count is not a count of distinct original census files. The embedded normalized maps remain available when scratch input files are removed.

| Original census observation | Files |
| --- | ---: |
| Mapped to another current path | 8,758 |
| Still at the original path; see the recorded semantic disposition | 1,455 |
| Explicit semantic extraction or reviewed retirement | 12 |
| Unresolved absent original file | 0 |

All recorded terminal destinations exist at this snapshot. This establishes path accounting, not behavioral equivalence or complete ownership. In-place files are **not automatically platform code**: the retained-source disposition records the platform/independent-runtime decisions separately from the applied product moves. The formerly retained Piano MIDI/bridge services and their composition helpers now belong to Piano; their move and injection evidence is included in this snapshot.

120 mapped source paths still exist: 119 stable CLI or satellite command entry points and the screen-host ActionBus public contract, which reexports the single platform authority. Their paths are retained explicitly in the inventory; their entry guards, arguments, environment anchors, and error behavior are covered by the move evidence and selected compatibility replay. Three Home-to-home-control target revisions were checked against the original AST bodies: only imports differ, current capability targets exist, and obsolete Home intermediates are absent.

## Reviewed residual ownership decisions

These 27 source-backed decisions supplement the larger owner batches. Each describes the intended owner or retention rule; a row is not a blanket completion claim. The per-group census observations and remaining gates are recorded separately.

| Source group | Ownership and retained behavior |
| --- | --- |
| books | Shared book-catalog capability: BookRecord/ISBN/metadata-provider union/cache/cover fallback; household /books API distinct from School reading/grants.23-file correction. |
| economy | Existing household coin Economy product, not Finance: ledger balance, blackout/spend sessions, archived earn-rule revisions.26-file correction; School/Fitness supply evidence through existing public seams. |
| donow | Existing DoNow product: learner dispatch, dedup-before-presence, occupancy/approval/attribution policy over8surfaces.22 addendum files plus corrected HaApprovalNotifier in690 map. Same four outcomes and callbacks. |
| entropy | Retain neutral platform freshness/observability: configured source/metric/weight/staleness projection and EntropyPanel; no course, budget, assessment or installed product constructor. EntropyConfigProjection remains generic defaults/source projection. |
| measures | Split actual semantics: MeasureRegistry neutral capability1; School weekly roster/window/query/API6; Fitness ring record projection + fixed fitness.weekly.rings State Gates producer2. School day/window authority supplied through public/injected date classifier; no Fitness private School import. |
| pianoaudio / Piano bridge | Piano product recording-library mirroring, MIDI junk-floor policy, conversion/image job/resources and APK bridge protocol, bodytheme.22-file correction; shared MIDI transport/OS primitives remain platform. |
| playback-hub | Media product installed fleet/taxonomy/color/volume-safety/schedules/admin policy, not neutral Player. Included in Media77 correction with content-filter; shared playback transport remains capability. |
| state-gates | Neutral State Gates capability engine/graphs/projections/transition journal/admin/API/CLI38; per-product assertions remain owners. installedStateGatesPolicy explicit host selection stays composition; it names School/Fitness contracts, never included in neutral engine. |
| trigger | Neutral device-dispatch capability44: modality auth/debounce/intent resolution/response protocol, optimistic ack/fallback; installed source/owner route selection stays host composition. school_learner metadata is propagated protocol, not School workflow implementation. |
| screens | Neutral screen-host query/port2 after required method split: Art preset resolution/frames/collections enrichment becomes injected Art callback at same original branch/read/log/error timing. Host cannot import Art product. |
| sheets | Neutral printable-sheets capability10: injected providers/cellKinds + layout/QR PDF assembly; root installed providers supply owner substance. Keep paper-visible rejection strings and legacy API statuses. |
| Art / canvas / admin | Art product curation field validation/crop bounds, preset/frame/collection policy, recency/selection and canvas scheduler orchestration, filesystem admin and15UI files.32-file correction; generic drawing primitives remain platform. |
| exercise | Shared reference-corpus capability6: immutable portable corpus/filter contracts + YAML repository used by School and Fitness; workout prescription/session governance remain Fitness. |
| content-filter | Media product parental/subtitle mute/review policy, part Media77 correction; model optional severity review never edits cues. Generic decoder/stream mechanisms excluded. |
| proxy | Content-catalog capability19 existing protocol helpers for source media/bootstrap/stream/thumbnail/composite resources. Source-vocabulary dispatch stays catalog protocol, not household learning/budget policy. |
| Upcoming | Home-owned calendar/todo presentation calls /api/v1/home/events;2 omitted UI files corrected. |
| Admin/Games | PartyGames installed definition administration7 UI files; generic Admin shell/config CRUD retained. Source/body-safe fixtures selected separately. |
| content / agents barrels | Legacy reexport barrels only, not retained implementations: remove unused mixed product exports or retarget exact reviewed typed public seams; agents mixed barrel already specified by267 plan. Do not certify physical barrel location as neutral policy. |
| Input / VoiceCapture / AppContainer / Auth | Retain neutral platform media-device/recording/WebRTC/keyboard/volume plumbing, configured app surface host, login/setup/session primitives and AuthGate. Installed registry and Glympse vendor iframe are composition/transport adapters, not Auto policy. Body/route selected consumer stays installed composition. |
| Admin remainder | Retain platform shell, household/account/config/device/scheduler/integration administration. Art/Media/Games/Health/Finance/agent-specific surfaces explicitly mapped owners. ShoppingConfig is installed retailer-connector configuration, not HomeBot wishlist or household earn authority. |
| devices | Retain neutral OS/kiosk/control/session/presence/friction mechanics with configured device factories; Piano protocol files mapped Piano. contentRequiresCamera has actual installed webcam/videocall selection, move exact predicate to composition and inject it into device service at same construction point (one correction), not generic kernel policy. |
| notifications / messaging / scheduling | Retain shared channels, intents, delivery, quiet-hours/options, deadline/run/cron and installed job executor ports. Producers/claim types/routes/timing selection stay owner/host; SchedulerOrchestrator injected School executor is a dispatch seam, not embedded curriculum. |
| cost / ai / logging | Retain neutral AI usage metering/model-pricing/budget/query reporting and generic AI transport/observability; no household coin ledger or product agent vocabulary. Product attribution selected by callers preserved. |
| hardware / scan / barcode / eventbus / events / midi | Retain generic raw firmware relay, scanner/NFC code/namespace dispatch, acknowledgement/debounce, realtime publication and MIDI event transport. Auto trip interpretation assigned Auto690; School assessment frame/scan recorder already School; raw OMR relay remains mechanism. |
| auth / config / common / core / qrcode / printer / static-assets / presentation / reference / shutdown | Retain platform account/config/semantic errors/core time/QR printing/public approved-asset distribution/reference HTTP/device shutdown mechanisms. Product inventories own record vocabulary and consumer selection; no broad legacy application-layer platform presumption. |
| weekly-review | No implementation left after690 map, all actual app/domain/adapters/browser/store/API source included; external retained tests stay original test locations. Empty folders do not count. |
| blank / time / displayer / dormant assets | Retain generic display/clock/connection/blank utilities. Whitespace-only LifelogApp.scss excluded from implementation map, retained as dormant artifact; no claimed product implementation from empty paths. |

## Explicit extractions and retirements

The four original Health/Nutribot primitive files are accounted for as semantic extractions, with their actual Health and Nutribot destinations listed in the inventory. They are not presented as blind file renames. The shared response-context class moved to platform with byte identity against its original implementation; one class remains authoritative.

The three obsolete Content barrels, mixed Agents barrel, and nutrition sheet-provider compatibility barrel were retired after consumers moved to owned interfaces. Their original hashes and dispositions are retained. The [29 unused School/Fitness forwarders](2026-10-09-unused-owner-facade-cleanup.json) were removed separately; all underlying implementations remain and all matching public-entry declarations have been removed.

Additional tracked corrections:

- [Catalog routers](2026-10-09-content-router-owner-manifest.json) and [public ownership corrections](2026-10-09-content-public-owner-corrections.json).
- [Generic catalog query port](2026-10-09-content-query-port-owner-correction.json), moved out of Feed without changing its class body.
- [Piano/School progress storage](2026-10-09-progress-store-owner-corrections.json), preserving the same Piano completion policy for the legacy School consumer.
- [Art screen enrichment](2026-10-09-art-screen-owner-corrections.json), separating Art policy and reads from the neutral screen host.
- [Gaming and notation](2026-10-09-gaming-notation-owner-manifest.json), including final portable policy destinations.

## Final selected verification and remaining acceptance

The [final verification record](2026-10-09-application-modules-final-verification.json) pins all 36 accepted final test-group receipts and their hashes. Independent comparison verifies 6,377 original passing case executions, 27 supplemental guards, and the exact same 11 failed executions as the baselines. Counts include overlapping groups; this is not a unique whole-repository test count or an all-tests-pass claim. The four Playback Hub and seven Producer failures retain their actual failed statuses, messages, and nonzero child exits.

The production Vite build passed with 109 application-owned chunks, including the actual Player, screen host, Piano, and Gratitude modules. All recorded chunk files exist. Of 69 public assets, 68 copied assets were independently compared byte-for-byte; the remaining asset is generated. Native module identity and owner embedding checks are included in the selected runtime evidence.

All 43 move maps resolve to present terminal files. Every one of the 8,795 unique mapped destinations is indexed, including reviewed files covered by ignore patterns. The full ownership audit checks private boundaries, dependency direction, and owner cycles. Layer ratchets are unchanged and native import-link checks pass. The local checkpoint itself is gated by the unchanged original staged/working pre-commit hook through the confined adapter; failure prevents the commit. No merge into main or deployment is represented here.

The native calculator remains an explicit acceptance gap: 27 executable suites passed 110 cases, while 19 suites remain unrun. Thirteen require unavailable `z80asm`; six require absent GUI, configuration, or release inputs. The seven named input paths are absent from the original tracked tree as well as this checkout. No inputs, native artifacts, or passing results were invented. Milestone 3 is therefore not certified complete.

## Retained ownership and final corrections

The [complete retained-source disposition](2026-10-09-retained-source-disposition.json) accounts for all 2,049 snapshot files: 1,451 retained files, 587 relocations, eight splits/relocations, and three reference-proven prototype retirements. There are no unclassified paths or pending structural transitions. Applied receipts preserve the configuration projections, lazy Piano hold policy, original command entries, satellite layouts, and neutral codec/port identities. All 74 original CLI command paths remain present.

The final source corrections include coherent Art assembly, shared Piano/School progress storage, Art screen enrichment, Media-owned playback filtering, the neutral playlist and AI badge, and canonical layer contracts. The final replay includes their original assertions plus the real Media hook and four Art assembly guards.

The owner-cycle corrections place School earning evidence in Economy as an adapter over injected School services, and Piano archive/rivalry recovery in Piano while exposing Chess archive naming explicitly. Generic volume controls belong to playback. The ActionBus authority and WidgetRegistry class belong to frontend platform utilities; screen and surround retain separate registry singleton lifetimes. Piano owns its teacher programs panel, supplied through installed composition to the School teacher shell. Original implementation bodies, identities, ordering, and test assertions are preserved as recorded in the applied packets.

Actual build verification exposed 88 stale Sass paths across 75 stylesheets. Each replacement resolves to the same one of ten canonical partials recorded in the move map; other style bytes and modes are unchanged. The build then passed. The whole-index whitespace check is clean; destination-only comparisons can report unchanged original body whitespace because they omit rename sources.

Normal frontend discovery now covers 1,748 applicable tests: 109 retained frontend tests, 1,638 owner-browser tests, and the relocated Gaming architecture oracle. Three synthetic tests exercise the real dry-run CLI, including patterns, runner routing, missing roots, and symlink/dependency exclusion. The actual Vitest configuration accepts all 1,638 owner-browser paths. Three existing visual harnesses also use the moved paths; the readalong stub intercepts the default Player entry its real lazy consumer imports. Their syntax checks pass; no additional visual/browser execution is claimed.

The [execution ledger](2026-10-08-application-modules-m2-m3-progress.md) records the checkpoint workflow and evidence. The pre-cutover tag remains `pre-application-modules-cutover-2026-10-08`; the current main commit is incorporated in the isolated refactor branch. The remaining native artifact gap is not reduced to source-file preservation or frontend build success.

The original commit hook rejected 13 raw filesystem imports in the Health server CLI subtree. All 23 files originated as CLI files and were moved to `modules/health/cli`, with 16 incoming wrappers/tests updated. The correction preserves implementation and assertion bodies and restores the original root dependency identities and repository/environment anchors. The filesystem gate remains unchanged.

Health CLI final replay: 146 original cases preserve exact baseline parity and 39 additional existing CLI cases pass. Native ESM resolution for uuid, dotenv, and js-yaml matches the original root scope. Working and staged filesystem audits pass after the layout correction. These 39 additional cases are separate from the 27 added guards in the final matrix.

The subsequent original hook link scan found one stale import in NutritionRepair.test.mjs. Its single import literal was corrected, its three original cases were included in the 39 supplemental cases above, and the 185-case Health retry passed with unchanged baseline assertions.
