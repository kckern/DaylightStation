# Recovered package-resolution experiment

This fixture preserves the synthetic experiment underlying R2-01 in the
[architecture review record](../../../../../docs/_wip/plans/2026-09-05-application-module-adversarial-reviews.md).
It tests packaging representability, not actual Moment, React, browser, native
module, lifecycle-script or production-image parity.

`fixtures/sibling` is the successful public-facade/runtime-facet layout.
`fixtures/ancestor` is the recovered rejected ancestor facade linked through
`file:../modules/fitness`, with descendant facet workspaces. It installs
successfully but cannot resolve `@probe/timezone` when loading its exports.
Other historical ancestor-workspace variants are not reproduced here.

The 33 preserved source/manifest/lock files have original and normalized SHA-256
values in [recovery.json](recovery.json). Only temporary directory prefixes were
replaced with `__ANCESTOR_ROOT__` and `__SIBLING_ROOT__`. The runner expands them
inside a new temporary directory, generates tarballs from the synthetic sources,
and generates fresh locks. Historical locks remain archived for inspection.
No cached installation or private session log is required to run it.

Use **Node 22.22.0 with npm 10.9.4**; the runner checks both exact versions.
After activating that toolchain, run from the repository root:

```sh
python3 tests/preimplementation/application-modules/experiments/review-package-resolution/reproduce.py \
  --node "$(command -v node)" \
  --npm-cli "$(npm root -g)/npm/bin/npm-cli.js"
```

The output is JSON suitable for redirecting to a task-owned temporary result
file. All installs, caches, generated packages and writes are confined to a new
OS temporary directory and removed when the runner exits. It invokes no project
entrypoint or household controller. npm runs offline with empty user/global
configuration; only these local synthetic packages are installed, with scripts
disabled. Those flags are experiment isolation, not a production install policy.

The runner requires install and clean `npm ci` to succeed for both layouts.
After each, separate Node processes exercise forward and reverse import order.
Sibling assertions require the three expected versions, distinct mutable
instances, equal direct/facade instances within each facet, and rejection of an
unexported deep path. Ancestor assertions require the specific missing-package
failure; an arbitrary error is not accepted as the negative proof.

The [captured reproduction](../../../../../docs/_wip/audits/2026-09-06-application-module-review-evidence/package-results.json)
records all 18 commands, their outputs and exit codes, and source hashes. It has
four passing sibling cases and four expected ancestor failures. No PRE checklist
item or real dependency gate is completed by preserving this experiment.
