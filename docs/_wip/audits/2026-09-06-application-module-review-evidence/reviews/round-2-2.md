# Round 2: recovered reviewer response

Reviewer: `architecture_review_r2`. Recorded: `2026-09-05T22:11:30.425Z`.
Source event: reviewer session line 260. Paths normalized as described in the evidence index.

---

A viable minimal strategy is now proven: **one contributor owner directory containing non-overlapping sibling workspace packages**.

```text
modules/fitness/
  owner.json
  README.md
  public/package.json   # @daylight/fitness
  server/package.json   # private server facet
  web/package.json      # private browser facet
  cli/package.json      # private CLI facet
```

Do not make `modules/fitness` itself a package/workspace. Its public package exposes narrow wrapper files that re-export the appropriate facet’s supported entry. This avoids the ancestor/descendant package overlap present in the failing fixture.

Verified fixture: `{fixture-root}`.

Using Node 22.22.0 / npm 10.9.4:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund \
  --install-strategy=nested --cache ./cache
npm ci --offline --ignore-scripts --no-audit --no-fund \
  --install-strategy=nested --cache ./cache
node backend/probe.mjs
node backend/probe.mjs reverse
```

Both installation methods added 11 packages; both import orders passed:

- Server/web/CLI resolve their intended 0.6.0 / 0.5.47 / 0.5.46 dependency versions.
- Same-version mutable transitive dependencies remain separate between facets.
- Direct source and public facade imports retain identical state within each facet.
- An unexported public deep import is rejected.

The fixture’s `--ignore-scripts` is safe only because these synthetic packages have no install scripts; it is **not** the proposed real-repository policy.

Plan limitations to retain:

- `nested` is a candidate install strategy, not proof of the repository’s full dependency parity.
- Real React peers, context/native singleton identity, Vite/Jest/Vitest, asset resolution, lifecycle scripts and Linux image installation still require WP-03.
- Public facades are permanent supported APIs, not old-path compatibility shims.
- Architecture checks must forbid consumers from importing private facet specifiers directly; Node exports alone do not enforce that policy.
- Workspace discovery must enumerate actual package directories and reject ancestor/descendant overlap.
- Explicit `type` and local `imports` belong in each applicable facet.

No repository files changed. This resolves the representability question raised by R2-01 without inventing a custom loader or manual symlink structure.
