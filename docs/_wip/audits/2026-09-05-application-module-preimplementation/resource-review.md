# Non-import resource and installed-shell review

`resource-review.json` joins tracked identities with source consumers instead of
assuming import resolution covers deployment. The scan parses 5,180 selected
runtime/operator JavaScript-family files without evaluating them. It links 466
resource import edges, source literals/templates, JSX URL attributes, fetch/location
calls, stylesheet directives, HTML references, worker defaults and public assets.
These are declarations and candidate references, not an emitted bundle graph.

The stylesheet pass accounts for 117 recognized directives: 111 quoted forms and
six URL forms. Quoted local/aliased targets are mapped; `sass:math` is the remaining
builtin, not a missing file. Seven gaming styles resolve through the actual
`@gaming-ui` Vite alias. Source references preserve original line numbers while
removing comments. This is not a Sass compiler pass or proof of rendering/layout.

## Selected computed references

The broad lexical scan includes configuration file names and generated paths,
which are not automatically bundled resources. The selected Gratitude/shared
closure contains twelve computed or context-relative references; every one is
classified in `resource-review.json.selectedComputed` with a fail-closed
source-line key. Six are FileIO's generic `.yml`/`.yaml` suffix or generated
image-name rules, two are the existing Gratitude household array authority, one
is the existing temporary-print authority, one is a font-directory-relative
face name, one is an editable UI placeholder, and one derives an already
allowlisted household configuration path. None is an untracked source/public
asset. A new or moved selected reference fails the review until it receives its
own disposition; this remains source classification, not a build-output proof.

There is one nonstandard bare Sass form: `CycleSpeedometer.scss` uses
`@use "cgTokens"`, resolved by Sass's importer from its sibling
`_cgTokens.scss`; it is not a Vite alias or npm package. Preserve that source
relationship if the Cycle Game moves, and add a disposable Vite/Sass candidate
build that fails when the sibling partial is absent. The current Vite settings
select the modern compiler but declare no Sass load path, so static resolution
is evidence of the source relationship—not proof of emitted CSS.

## Concrete first-move contracts

Gratitude imports its stylesheet and the shared-source `thanks.svg`/`hopes.svg`
icons. Its avatars are not bundled files: `DaylightMediaPath` rewrites
`/static/img/users/<id>` to `/api/v1/static/img/users/<id>`. FamilySelector uses the
same URL mechanism. Source moves must preserve both imported icon bytes and this
public request contract.

Four new `CASE-RESOURCE-*` tests exercise the original static router/service/file
repository and CanvasFactory with synthetic files:

- Generic `/img/users/<id>` **does not** get the repository's typed `/users/:id`
  fallback to `users/default`. The UI's explicit `users/user` fallback is another
  request, not a server alias for `default`.
- Exact filenames precede extension probes; the probe order is SVG, PNG, JPG,
  JPEG, GIF, WebP. Content type, byte length, one-day public cache header and CORS
  header remain unchanged for the tested responses.
- Only generic raster-image requests with positive dimensions invoke resizing.
  A resize failure returns the original image. Typed user images and SVGs do not
  use that resize branch.
- Missing configured font files are caught by the factory, which still creates
  a native canvas. This proves best-effort behavior, not which fallback glyphs
  are used. A test that only expects a PNG would miss font loss; the separate
  missing-font negative control still fails the named bundled-font assertion.

Synthetic raster bytes in the routing tests are not image-decoder or visual
goldens. No private avatar/font root, live HTTP socket or printer was used.

## Bundled fonts versus runtime overrides

The source contains seven bundled font files and two accompanying notice files
under `backend/assets/fonts`. All nine are indexed with hashes/modes. A Roboto
notice is not present in that tracked folder; distribution provenance requires
separate confirmation rather than inventing a license record.

Three source-relative readers address that bundled tree. If the proposed
canonical destination `platform/server/assets/fonts` is selected, the exact
literal substitutions are:

| Consumer after proposed source placement | Required relative font root |
|---|---|
| `platform/server/rendering/CanvasFactory.mjs` | `../assets/fonts` |
| Retained `backend/src/1_rendering/fitness/TimelapseFrameRenderer.mjs` | `../../../../platform/server/assets/fonts/roboto-condensed` |
| Retained `backend/src/1_rendering/school/documents/measure.mjs` | `../../../../../platform/server/assets/fonts` |

Leaving CanvasFactory's old literal unchanged at its proposed location resolves
to repository-root `assets/fonts`, not the proposed font authority. The JSON
records this path simulation and all nine candidate destinations. These are
conditional exact changes, **not** approved package/public-resource interfaces.

The subsequent [rendering/font specification](rendering-boundary.md) now selects
that canonical asset authority and **supersedes those three conditional private
paths** with one system font-directory export. CanvasFactory imports it privately
within platform; Fitness and School use its public entry. The new review also
identifies two original test fixture roots and 123 selected source/reference
occurrences. The table above remains path-impact evidence, not an additional
changeset to apply. All nine asset hashes/modes and existing runtime overrides
remain required. No fonts moved or native registration was run by this review.

Installed Gratitude composition explicitly passes the configured font path or
the runtime media font directory. That override is not the bundled fallback and
does not move with source. Its actual bytes are not captured by the bundled-font
test. Font registration remains process-global, per invocation and best-effort;
native canvas identity stays a separate package/build constraint.

## Dynamic SVGs, workers and native resources

Four eager SVG glob registries expand against tracked source:

| Registry | Files | Import form |
|---|---:|---|
| Piano UI icons | 80 | `?raw` |
| School geography flags | 50 | `?url` |
| School subject icons | 33 | `?raw` |
| School clickable assets | 1 | `?raw` |

Flags are eager despite a source comment describing them as lazy. `?url` does not
prove a particular emitted filename/inline form; that is a build observation.
All keys and bytes must remain stable unless a separate resource change is approved.

School subject icons also have a **backend reader**:
`FilesystemSchoolAssetResolver.createSubjectIconResolver` defaults to the frontend
source directory. A future image that retains only `frontend/dist` would lose that
backend resource dependency unless the approved asset authority changes too.

Four Worker construction sites are paired with five default worker sources:
Stockfish play and analysis, Connect Four, Checkers, and the cubejs-backed cube
solver. The serialized opponent shares a constructor across two games. Configured
worker-path overrides, correlation messages, helper imports and package dependencies
are recorded without starting a worker. Stockfish's root-installed lite-single
JS/WASM files must survive Docker's variant pruning; the package's default symlinks
can be dangling afterward, so default loading is not equivalent.

The pairing is explicit enough to prevent an apparently local source move from
silently changing a runtime entry point:

| Default-owning adapter | Worker and transitive resource | Installed consumers | Move-preserving seam | Required later negative/control |
|---|---|---|---|---|
| `StockfishEngineAdapter` | `stockfishWorker.mjs` → `loadStockfish.mjs` → root `stockfish` lite-single JS/WASM | backend composition, Piano Games composition, chess calibration CLI | `createStockfishEngine({ workerPath })`; source-relative default remains private | Existing adapter test injects a missing/boot-failing worker and verifies fallback; package/image identity is separate. |
| `StockfishAnalysisAdapter` | `stockfishAnalysisWorker.mjs` → the same loader and package | backend composition, chess calibration and review CLIs | `createStockfishAnalyst({ workerPath })`; source-relative default remains private | Analysis contract and package identity must be checked independently; do not infer a valid engine merely from a source import. |
| `ConnectFourEngineAdapter` | `connectFourWorker.mjs` → shared Connect Four opponent | Piano Games composition | `createConnectFourEngine({ workerPath })`; it passes the resolved path into the shared serialized lifecycle helper | Existing adapter test plus lifecycle helper's timeout/correlation behavior; do not relocate its shared rules import independently. |
| `CheckersEngineAdapter` | `checkersWorker.mjs` → shared Checkers opponent | Piano Games composition | `createCheckersEngine({ workerPath })`; same serialized lifecycle helper | Existing adapter test plus lifecycle helper's timeout/correlation behavior; do not relocate its shared rules import independently. |
| `KociembaCubeRecoverySolver` | `kociembaWorker.mjs` → `cubejs` | backend School composition | `new KociembaCubeRecoverySolver({ workerPath })`; source-relative default remains private | Existing solver test checks returned moves; `cubejs` installation/image identity remains separate. |

`SerializedWorkerOpponent` is infrastructure local to the two Piano Games
adapters, not a second default-path authority. It receives an already-resolved
path and owns lazy spawn, serialization, correlation, timeout, recovery and
disposal. Thus a future generic gaming capability may export an intentional
lifecycle API, but the Gratitude rehearsal must neither promote it implicitly
nor change the adapters' injectable `workerPath` seam. No worker was started for
this inventory.

There are 66 tracked public artifacts, including three TensorFlow WASM files,
fonts, static scripts/media, manifests and service workers. Player's CRT shader
uses a module-relative `?raw` import; the public CRT-lab shaders are separate files.
No automatic promotion of a product asset into platform follows from reusability.

The pose-loader source has a binding mismatch: five parallel imports are
destructured into three variables; `tfBackendWasm` receives webgl and
`poseDetection` receives wasm. That makes names/comments insufficient evidence
of intended model/WASM activation. This is a source finding, not a newly executed
Fitness failure or authorization to repair it during relocation.

## Installed shell and Docker

The Vite source entry is `frontend/index.html`; it references `/src/main.jsx`,
the root manifest, icons/fonts, a boot-error trap and `/sw.js` with root scope.
A separate CRA-era `frontend/public/index.html` is still tracked. Its actual build
copy/output interaction needs testing; do not delete it or assume it is the entry.
The manifests reference PNG icons absent from the tracked public population; this
is missing source/build provenance, not a claimed production HTTP status.

The root worker's `daylight-shell-v2` cache distinguishes hash-shaped `/assets/`
URLs (cache-first) from stable names (network-first, cached fallback on rejection).
It bypasses non-GET, cross-origin, `/api/` and `/media/` requests; navigations refresh
the cached `/` shell. Non-OK HTTP responses are not the same as network rejection.
Its cache is capped at 120 entries; activation deletes older shell-cache versions.
The old Feed worker is a no-op and FeedApp unregisters matching old registrations.

The boot trap only governs pre-mount failure. It retries, tracks attempts in
sessionStorage/window.name, and on later attempts unregisters origin workers and
deletes caches before reloading. These source policies are requirements for the
later loaded-client recovery drill, not proof that the drill has passed.

The report records each Docker COPY instruction and ordered ignore rule. The
current image copies root/backend/frontend manifests before three separate
`npm ci` calls, then shared/backend/frontend/CLI source before the Vite build.
It does **not** copy `modules`, `capabilities` or `platform`. Extensions are excluded
for separate builds. New roots must reach the correct install/build stages with
the right ownership; source-only import success cannot prove that.

No approximate Git-ignore matcher is presented as Docker context proof. Exact
engine context selection, ignored/generated inputs, compiler output, native/image
identity and both loaded-client directions remain open build experiments.
