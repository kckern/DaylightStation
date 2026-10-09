# Bots, calls and display ownership

Source-backed milestone 3 partition at `759be3aaf7`; not an implementation receipt.
Keep existing runtime registrations, public URLs, bot identities and stored paths.

| Existing implementation | Owner and concrete obligations |
| --- | --- |
| `homebot` application/adapters, HomeBot router and composition | `modules/homebot`. Owns conversation/category/assignment workflows; retains Gratitude's injected five-argument `addSelections` command. Its household repository is a HomeBot port, even if backed by shared household identity. |
| `journalist` domain/application/adapters, API handlers/router and composition | `modules/journalist`. Include prompts, debrief repository, journal-entry/message-queue persistence, logging gateway, scheduled delivery and quizzes. Generic Telegram transport is shared; interview/quiz policy remains Journalist-owned. |
| `journaling` domain/application and `YamlJournalDatastore` | Journalist-owned journaling subcomponent. It has a distinct `JournalEntry` and store contract; preserve those implementations and internal namespaces rather than merging same-named entities. No runtime caller was found in `backend/src` beyond its own service/store, so do not activate it as a new feature. |
| `newsreporter` application/adapters/rendering and CLI | `modules/newsreporter`. Owns report schema, placeholders, source selection, consolidation, run history and printer-sink policy. Shared agent/harvester/HTTP/printing facilities are injected; the report product does not become generic scheduling infrastructure. |
| `homeline` application/adapters/API, `Apps/CallApp*`, `Apps/call`, AppContainer VideoCall | `modules/homeline`. Phone/TV presentations share the same call product. Preserve leases, signaling identity, recovery, session-storage keys and existing `/call`/API/catalog identities. |
| `Input/hooks/useWebRTCPeer` and `useIndependentMedia`, shared by CallApp and other capture surfaces | Reusable media-input/WebRTC capability, settled with the full Input partition. Publish the existing hooks; do not duplicate them under Homeline or absorb unrelated input implementations into the call product. |
| Backend `ambient` domain/application/adapters | Screens/display product policy, rather than generic timer infrastructure. It chooses scheduled displays, inspects playback idleness, tracks owned power state and calls wake/load/power-off operations. Scheduler implementation can remain a narrow adapter. |
| Backend `eink` service/ports/adapters/rendering/widgets and e-ink panel client | Screens/display product's e-ink surface. Actual policy includes forecast-hour selection, wake schedule, panel navigation, refresh nonce and telemetry. Generic browser screen-host mechanics do not own this policy. |
| Backend `epaper` service/port, hardware EpaperAdapter, route/composition | Screens/display e-paper surface/provider. Preserve injected renderer/data provider and the existing unconfigured behavior. Do not newly enable the adapter merely because its source moved. |

## Screens is justified by policy, not by a room configuration

These backend display services provide actual product policy distinct from the
neutral browser host. A single Screens owner can hold ambient scheduling and
e-ink/e-paper presentations while `capabilities/screen-host` remains generic.
The controller should use that coherent owner rather than manufacture separate
applications for every hardware folder. Existing room-screen configuration stays
configuration; installed browser widget selection stays host composition.

`AmbientSchedulerService` must preserve its first-tick state, reentrancy guard,
60-second interval, state persistence and failed-load ownership cleanup. The
renderer registry and built-in e-ink widgets move together; raster/font assets and
PNG framing must be included in resource-path/artifact checks.

## Cross-product call safety

`CallStateService` currently holds one module-level lease authority, installed by
`app.mjs` and consulted by device power paths. Publish those exact operations
through Homeline's small call-state entry, or inject them into device composition.
Do not create a second authority, duplicate the module or eagerly import the
entire call stack into device utilities. Moving files must preserve one native
module identity and the behavior blocking force-end during an active lease.

## CLI and satellite source rules

- Inventory CLI commands and satellite sources by actual consumer/port ownership.
  A CLI path may remain as a thin stable entry while its product implementation
  moves; that entry must import the owner's public operation and contain no
  copied product policy.
- Application-specific satellite code follows its product owner (for example
  Piano and Fitness). A reusable provider-side relay follows its capability or
  integration. Truly independent/transitional targets may retain their current
  root with an explicit recorded disposition; do not silently omit them.
- Preserve invocation names, deployment identifiers, manifests, build inputs and
  protocol messages. Source relocation does not authorize firmware deployment,
  updating installed devices, a new satellite SDK, or new activation behavior.
- Inspect resource/build references, not just JS imports: PlatformIO/CMake,
  firmware assets, shell scripts, Docker COPY inputs, aliases and relative paths.
  Verify available build targets or state the exact unverified target; a source
  grep is not evidence of a completed native/device build.
- Shared transport, secrets, clocks and generic scheduling stay infrastructure;
  bot jobs and product selection move with the owning product while the process
  host continues installing and disposing them once.

This partition must be combined with the full Input, device-dispatch and
integration inventories before their respective batches are marked complete.
