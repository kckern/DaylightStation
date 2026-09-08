# Shared rendering and bundled-font boundary

Status: selected source/public/resource specification, not implementation or
runtime approval. Exact spans, proposed bytes, package fragments and preservation
constraints are in [rendering-boundary.json](rendering-boundary.json).

## Ownership and public surface

Move the three current `backend/src/1_rendering/lib/` implementations once into
`platform/server/rendering/`. These are platform-owned **rendering**, not system
utilities that every layer can import. Gratitude's card/theme remain Gratitude;
Fitness receipts/timelapse, School documents, Piano images and eink widgets retain
their respective product ownership. D2 application services still consume
presentation ports; this proposal grants no application/API-to-renderer access.

| Public entry under `@daylight/platform/server/` | Exact names | Layer |
|---|---|---|
| `rendering/canvas-factory` | `initCanvas` | rendering |
| `rendering/layout-helpers` | `drawDivider`, `drawBorder`, `roundRect`, `drawCover`, `flipCanvas`, `formatDuration` | rendering |
| `rendering/text-renderer` | `wrapText` | rendering |
| `system/assets/bundled-fonts` | `bundledFontDirectory` | system |

Each facade forwards its canonical private server implementation. No wildcard,
default export, duplicate helper or new product renderer is introduced. All eight
existing drawing names have actual consumers outside the old aggregate. The 17
incoming source edges comprise 14 static consumer imports and three re-exports
from `backend/src/1_rendering/lib/index.mjs`. That aggregate has no incoming source
edges and has a separately gated one-file retirement, not a compatibility shim.

`formatDuration` is the existing presentation formatter, not a replacement for
D4 pure time or D8 clock defaults. No new port is invented for ordinary helpers.
D3/D5/D7/D10 remain binding independently of ownership and public visibility.

## One source-shipped font authority

Select `platform/server/assets/fonts` for the nine current bundled artifacts:
seven TTF files and two supplied notice files. The JSON records every source,
destination, byte count, SHA-256 and mode. Do not duplicate these in the backend
tree, move runtime media/config font directories, or change frontend font URLs.

A new private system module, `platform/server/system/assets/bundledFonts.mjs`,
exports the module-relative absolute directory string `bundledFontDirectory`.
It uses only Node URL conversion: no filesystem operation, configuration load,
registration, caching, transport or application data. Its public facade is the
single supported cross-owner asset-location entry; filenames relative to that
directory retain their current contract. This is an internal source relocation
seam with existing consumers, not a new user feature or universal asset service.

| Existing consumer | Proposed binding | Behavior that must remain |
|---|---|---|
| Shared `CanvasFactory.mjs` | Private same-owner relative import of the system locator | `fontDir || DEFAULT_FONT_DIR`, primary then extra faces |
| Fitness `TimelapseFrameRenderer.mjs` | Public locator, append `/roboto-condensed` | Truthy override branch, three registration attempts and current retry flag |
| School `documents/measure.mjs` | Public locator | Default only for `undefined`; explicit null/empty string stay distinct |
| School `documents/workbookTheme.test.mjs` | Public locator for fixture root | All original theme/font/license assertions |
| `tests/unit/rendering/eink/stub-widgets.test.mjs` | Public locator for fixture root | All original PNG/layout assertions; remove only test CWD coupling |

This supersedes the **three conditional private-path rewrites** in
`resource-review.json`: School and Fitness must not reach through relative paths
into platform's private package tree. Two original test fixtures were additional
font-root consumers. There are ten exact binding/root edits for these five files.

The original CanvasFactory URL at its proposed location would resolve to
repository-root `assets/fonts`, not the chosen authority. The locator's own URL
resolves to `platform/server/assets/fonts`; this source/path calculation is not
a native font-registration, PDF metric or package-content test.

Preserve supplied notices. There is no Roboto notice in the nine tracked bundled
artifacts; distribution provenance remains an explicit gate, not permission to
invent a license or infer open-source readiness. Frontend converted/public font
bytes remain separate; its existing license-location comment has an exact
spelling-only proposed update.

## Source evidence and existing quirks

The specification has **41 edits across 22 existing files**, plus five proposed
new source files (four facades and the locator), three implementation moves,
nine asset moves and one gated aggregate retirement. Only the edits/new-source
definitions participate in the combined in-memory proof; no moves or deletions
have been performed.

The selected literal census classifies **123 occurrences in 29 protected files**:
imports, source-root expressions, JSDoc/current guide paths, retained illustrative
filenames and historical plans. All 13,083 protected artifacts are accounted for
during the scan; split/computed/untracked external references still need their
separate closure review. Current LoA-guide changes are path spellings only, not
changes to architectural permissions or the presentation test.

Important baseline behavior is not cleanup authority:

- CanvasFactory suppresses font-registration failures independently and can
  still emit a PNG with system fonts. A PNG signature is not font parity.
- Native font registration is process-global even though these helpers have no
  owned service lifecycle. Preserve the intended canvas module instance.
- Timelapse attempts Regular, SemiBold and a currently absent Bold file inside
  one `try`; the earlier registration side effects can occur without setting its
  success flag. Do not add a font or repair retries during a filesystem move.
- School measurement/output share font aliases and exact geometry; truthy
  fallback changes would alter explicit null/empty overrides.
- Existing rendering guidance says font failures propagate, unlike the actual
  best-effort CanvasFactory. Record/adjudicate that discrepancy separately;
  neither rewriting guidance nor changing fallback behavior is a move-only fix.

## Native dependency gate

Read-only manifest/lock inspection identifies three different canvas versions:

| Authority | Version |
|---|---|
| Installed backend package | 3.1.0 |
| Backend lockfile | 3.2.3 |
| Root installed package and root lockfile | 3.2.1 |

Both manifests declare `^3.2.1`; installed backend 3.1.0 does not satisfy that
declaration. The source spec fingerprints both manifests/locks and both installed
canvas manifests. It does not install packages or assert that native binary
ABI, PDF metrics or image output are equivalent. The earlier installed-scope
tests cannot stand in for the locked candidate. Resolve the existing baseline
discrepancy through the package decision and disposable experiment before adoption;
do not silently upgrade, pin old bytes or fall back to root.

## Disposable native and original-suite evidence

The separate `rendering-identity` receipt now exercises fifteen ordered steps:
two unchanged original suites (ten named cases) in the old layout, the same ten
cases with only their two specified imports changed in the candidate, and the
same ten again after restoring the candidate. Original assertion/helper bodies,
local bindings and full candidate hashes agree with the combined specification.
The baseline keeps the exact original `#rendering/*` package-import mapping;
the candidate uses the four proposed public package entries, without aliases,
the preparation scope loader or root test setup.

Ten native probes execute in twelve fresh processes. The three original bodies
and six source-specified edits, one locator, four facades and nine original
font/notice artifacts are materialized only in disposable layouts. Seven real
faces register; five falsey Canvas overrides retain the default and a truthy
override retains its own directory. Missing primary/extra fonts and invalid
supplied roots remain best-effort, with later faces still registering. The
registerFont wrapper delegates every actual native call; it records order and
success, not a fake registration result. Product sources remain unchanged.

Old/new selected measurements, wrapped lines, pixels, 180-degree rotation and
PNG bytes match under installed backend canvas **3.1.0**. This is not evidence
for backend locked **3.2.3**. All 203 files in both installed canvas packages and
seven parser/runner inputs are fingerprinted, not the full transitive native/OS
environment. Manually linked task packages are not an npm-install proof.

| Controlled graph fault | Required failing probes |
|---|---|
| Copy of LayoutHelpers behind public facade | Canonical helper binding |
| Locator points at absent directory | Font root and default registrations |
| Roboto Regular omitted | Nine-asset inventory and default registrations |
| Kongtext notice omitted | Nine-asset inventory; rendering still succeeds |
| Candidate resolves root canvas 3.2.1 | Expected native resolution/version |

Each fault has a fresh restored process; all 43 written fixture files and six
links restore exactly, including source/test/font bytes and modes. The packet
auditor independently reconstructs source edits, suite titles, manifest and asset
hashes, parses complete outcomes and checks the native input population. Its six
receipt-defect controls are verifier tests, not product contract mutations.
The ten original cases and these mechanism observations remain separate from
the 345-case baseline catalog and eleven product red/restored pairs.

Reproduce with the reviewed `CMD-RENDERING-IDENTITY` command:

```sh
PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-rendering-identity.mjs
```

## Acceptance still required

Expand safe affected-owner coverage to School
PDF/workbook/receipt, Fitness receipt/timelapse, Piano image and eink widget
consumers; fourteen imports are not a test population. Keep existing assertions,
goldens, dependency scope and caller override differences.

The selected native experiment does not prove the full candidate's moved and
retained consumers share one native instance, or registration-before-creation
under all callers. It does not exercise PDF null/empty defaults, Timelapse retry,
all draw/style/override behavior mutations, original frontend URL preservation,
full package contents/locks or Linux image output.
Actual semantic enforcement must reject forbidden renderer imports and private
cross-owner paths. See **IMP-SHARED.04.5** in
[implementation-backlog.md](implementation-backlog.md) for dependencies and
coherent rollback. No existing source, test, font, manifest or guide was edited.
