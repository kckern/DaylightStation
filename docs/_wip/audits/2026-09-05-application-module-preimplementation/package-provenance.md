# Package and runtime-instance provenance

Status: static installed-scope characterization for the selected 50-source
Gratitude/shared-prerequisite foundation closure. It is not package adoption,
lockfile reconciliation, image validation, or permission to move source.
The machine-readable [package provenance](package-provenance.json) records every
one of the closure's 20 package import edges as importer, line, specifier,
installed package version, canonical instance path and entry path.

## Identity rules preserved by the rehearsal

| Rule | Current instance(s) | Migration consequence | Evidence |
|---|---|---|---|
| Must share React | `frontend/node_modules/react` 18.3.1 | A provider, its consumers, and ReactDOM must use one React instance. A second copy breaks hooks or misses the original context provider. | `CASE-PKG-REACT` |
| Must share backend canvas | `backend/node_modules/canvas` 3.1.0 | Moved and retained rendering callers must resolve this same native module; font registration is process-global. | `CASE-PKG-NATIVE`; rendering identity red/restored probe |
| Must separate timezones | backend 0.6.0, frontend 0.5.47, root 0.5.46 | Do not hoist or collapse timezone packages merely to make a new package layout convenient. | timezone cases; offline nested-install red/restored probe |
| Must separate canvas | backend 3.1.0, root 3.2.1 | Root canvas is not a permitted fallback for server rendering; its different module and constructor are a controlled failure. | `CASE-PKG-NATIVE`; rendering root-resolution red probe |

The same artifact also records source singleton constraints that are not package
instances: the browser WebSocket context needs its matching React graph; the
server logging dispatcher retains one current mutable graph; and the browser
WebSocket service retains its present browser scope. A public facade forwards
those instances—it does not create a second context, dispatcher, or service.

## How to use it in implementation

Every implementation card that changes an import in this closure must retain the
recorded instance path or intentionally revise this document and its red control
first. A card that needs a package not listed here must add its actual importer,
resolved instance/version/entry and an identity classification before it is
approved. `dependency-ledger.json` remains the reverse-impact source for
callers outside this closure; this review does not declare them safe to move.

The installed backend canvas version differs from the backend lockfile and both
manifests declare `^3.2.1`. That discrepancy remains an implementation
prerequisite: no relocation may silently pin, upgrade, hoist, or fall back to
the root package. The successful offline nested fixture proves only its supplied
local package bytes and red/restored package boundary controls, not original
lock/peer graph adoption or a deployable build.

Regenerate after a relevant dependency, selected source, or ledger change:

```sh
PRE_TOOLCHAIN_ROOT=<installed-checkout> node tests/preimplementation/application-modules/tooling/review-package-provenance.mjs
```
