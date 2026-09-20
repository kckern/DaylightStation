# Adaptive playback baseline

Status: initial read-only baseline; runtime matrix and implementation pending.

## Source and build identity

- Local HEAD: `df16b3d71c297b8cb068ebe6869f3d24e25849b7`.
- Deployment source HEAD: `b9efaddcc215e63471ef9a6b402a286cdd85197d`.
- Deployment source worktree reported clean at inspection.
- Running image: `sha256:a8cfdbc618fb20b66e88bc39467eaec802849006ea2dd14095c28379500ce745`.
- Running container started: `2026-09-20T03:12:04.641522467Z`.
- Container `org.opencontainers.image.revision` label is absent. The image's
  source revision is therefore unverified; deployment-tree HEAD is not a substitute.
- Local changes at inspection consisted of the adaptive-playback documents and
  an unrelated untracked extension build directory, which was left untouched.

## Existing validation

- `npm run audit:layers`: exit 0. Rules were within their configured baselines;
  `apps-success-false` has 44 existing baseline occurrences. This is not evidence
  that existing shared code contains no provider-specific semantics.
- `npm run check:parse`: exit 0, 9,952 files parsed and 11,872 scanned for conflict
  markers. No backend was started by these checks.

## Runtime evidence still required

The full configured-provider inventory, client-profile census, correlated
throughput/buffer measurements, and owned-session cleanup baselines have not yet
been completed. Prior observation of two software encoders is not proof of an
orphaned duplicate or insufficient real-time throughput. No acceptance threshold
is claimed satisfied from that observation.

Before execution, reconcile source history in an isolated worktree. Before
runtime certification, establish a reproducible image-to-source identity through
build metadata or verified packaged-source comparison. Record device and provider
coverage per the [implementation plan](../plans/2026-09-19-adaptive-playback-implementation.md).
