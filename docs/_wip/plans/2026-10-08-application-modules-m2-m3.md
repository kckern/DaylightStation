# Application ownership cutover: milestones 2 and 3

User authorized both milestones to completion after Gratitude checkpoint759be3aaf7. Work only on refactor/application-modules. No production deployment, push, merge into main, activation/discovery redesign or data migration. Roadmap0.4–0.7 governs; existing numbered platform folders need not be renamed.

## Complete source universe and ownership inventory

[Tracked census](2026-10-08-application-modules-m2-m3-census.csv) captures917 real groups covering all10,225 tracked files under backend/src, frontend/src, shared, cli and _extensions at759be3aaf7. This includes hooks/context/lib and API/composition files outside conventional owner directories, plus explicit retained-platform and independent-runtime dispositions. Empty directories are excluded. This is the complete enumerated source universe for classification, not a claim that every mixed group is already resolved. External tests/jobs/configuration/device consumers are included through incoming-reference inventory for each owner; CLI and satellite source are directly enumerated rather than treated only as consumers. Ownership decisions below and the ledger must account for every census row before M3 completion.

Clear application owners: Piano, School, Fitness, Health, Automotive, Feed, Finance, Home, Life, Media, Livestream, Weekly Review, Gratitude, Party Games, HomeBot, Journalist, Nutribot, Newsreporter and the small installed AppContainer surfaces. App-only shells, admin editors, assets, configuration meaning, providers/policies and colocated tests follow their owner. Domain-specific agents follow their product; generic agent orchestration/framework is a named shared facility. Existing products without a main route remain in scope.

Shared facilities include playback, screen hosting, household identity, notation and generic gaming kernel/mechanics/rulesets. Product experiences/providers remain product-owned. Player is reusable playback; Piano video policy, School lesson semantics and Fitness governance are not playback infrastructure. Configured screen definitions do not automatically imply a new Screens application. Platform retains neutral transport/auth/config/persistence/logging plus explicit installed assembly. Admin shell/generic forms remain infrastructure; product admin pages move.

Resolved source-backed [content/Media/playback partition](2026-10-08-application-modules-content-ownership.md) separates catalog vocabulary/providers, shared playback execution, and Media product policy.

Resolved source-backed [agent partition](2026-10-08-application-modules-agent-ownership.md) assigns framework/runtime separately from Health, School, Life, Media and Home policy; notably the event-query helper is Health-owned despite its framework folder.

Resolved source-backed [Health/nutrition/Nutribot partition](2026-10-08-application-modules-health-ownership.md) keeps shared nutrition record authority with Health and Telegram conversation/transport with Nutribot; exact record/stamp/scale contracts remove the current reverse bot dependencies.

Resolved source-backed [bots/displays partition](2026-10-08-application-modules-bots-displays-ownership.md) preserves HomeBot/Journalist/Newsreporter and Call products, shared input transport, and actual Screens display policy separately from neutral screen-host. No per-room product or epaper activation is introduced.

Mixed groups requiring explicit file-level disposition before their batch: agents; content/catalog/media and providers; health/nutrition/nutribot; home/devices/playback-hub; gaming experiences versus kernel; generic persistence files versus product repositories; rendering assets; scheduler jobs and lifecycle factories; Admin pages; small widgets/assets; portable shared code. No blanket directory classification substitutes for these decisions. No owner is invented solely to fill a target diagram.

## Milestone 2: Piano/host/playback proof

1. Capture current synthetic focused tests: widget registry/PanelRenderer; playerSessionBridge/registrySessionSource controls; Player session port/scope; Piano video policy/resume/remount/screen control; backend Piano course queries and screen authority wiring. Publish a reproducible contributor harness that needs no household data, devices or live services. Reuse the verified Landlock lane and negative controls.
2. Establish shared dependency scope once: ignored owner/server/node_modules links to canonical backend scope and owner/browser links to frontend scope. One idempotent setup helper refuses real directories/unexpected links, checks readiness, and is wired into developer setup and Docker/sanitized staging. Native ESM/require/dynamic export conditions and browser identities must be exercised; no install/hoisting/version change.
3. Move Piano's bounded core server/browser ownership to modules/piano. Expose explicit widget/component and server-composition entries. Preserve routes, course policy, video/watch history, note handling, input controls, session/events and cleanup. Move generic Player/controller/session runtime to capabilities/playback. Move neutral host/layout/input/overlay/session contracts to capabilities/screen-host; installed widget selection from widgets/builtins.js belongs to frontend composition. Generic host must never import Piano/School/other installed consumers. Keep one registry/authority, with a host consuming Piano's published widget and Piano consuming neutral host/public playback contracts.
4. Account separately for piano-games/audio/MIDI and gaming providers; migrate Piano-specific policy with Piano where evidence establishes ownership, retaining generic machinery in its named capability. Any temporary legacy dependency facade has exact consumer/removal rows and disappears during M3.
5. Verify same assertions plus embedding/lifecycle controls, native dependency identities and actual production-style Vite artifact. Integrate fresh main changes at safe boundaries. Use original confined hook at coherent checkpoint, not after every file/batch.

## Milestone 3: complete remaining ownership

Use the census as a mandatory ledger, not a suggested subset. Resolve mixed groups, then move whole owned vertical slices exactly once: domain/application/ports/adapters/API/rendering/composition, browser surfaces/admin/styles/assets and product-specific portable/device code. Keep stored formats and catalog/routes/registrations unchanged. Update all consumers to explicit public contracts; no blanket old reexport tree, duplicate registration or duplicated implementation. Remove temporary migration facades once target owners exist. Hosts finish with installed assembly/shared infrastructure rather than application policy.

Execute dependency-ordered batches: reusable facilities and product providers; largest product owners (School/Fitness/Health/Media); remaining coherent products/bots; small installed surfaces and mixed residuals. Batches may run in parallel only after shared interfaces and edit ownership are fixed; otherwise serialize. Each batch has a before/after selected test population and source/resource checks. Do not silently drop assertions or increase architecture baselines.

File moves require resource-path audit as well as import rewriting: import.meta.url/dirname/new URL, workers, bundled YAML/fonts/SVG, dynamic imports and test fixture roots. Rewrite import specifiers precisely; resource strings need explicit reviewed relocation. Preserve native package export conditions. Scanner success alone is not artifact proof.

## Completion gates

M2: real Piano contributor/embedding proof, generic host free of installed-consumer imports, reusable playback with product policy retained, baseline-equivalent behavior and built assets.

M3: every census group has an implemented product/capability/platform disposition; no residual application implementation in host layers, missing owned assets/jobs/config/admin or obsolete registration; complete actual test discovery and public-boundary checks; selected full-stack/core-flow compatibility evidence; native and actual built artifact proofs; original staged/working hook passes; latest main incorporated without disturbing other work; clean local checkpoint ready for review/cutover. No deployment or broader runtime redesign is claimed.

Source-backed [gaming/notation partition](2026-10-08-application-modules-gaming-notation-ownership.md) separates Party Games/Arcade/Piano policy from reusable runtime and notation. Its CSS closure finding is being corrected before the M2 checkpoint.
