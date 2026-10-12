# Current HTTP source census

`tests/readiness/application-modules/current-http-source-census.json.gz` inventories the immutable serving source `bf35ca204168412de03e561db0ecd00e5e7bfcc4` and candidate source `9dc4230d5a5c1e7f0f5ff5d394b7c7295d155adf`. It is an offline source artifact, not a production method/template denominator or an execution result.

Generate it from the repository root with the existing installed Babel parser:

```sh
node tests/readiness/application-modules/build-http-source-census.mjs --controls
node tests/readiness/application-modules/build-http-source-census.mjs bf35ca204168412de03e561db0ecd00e5e7bfcc4 9dc4230d5a5c1e7f0f5ff5d394b7c7295d155adf tests/readiness/application-modules/current-http-source-census.json
node tests/readiness/application-modules/project-http-source-census.mjs --controls
node tests/readiness/application-modules/project-http-source-census.mjs tests/readiness/application-modules/current-http-source-census.json tests/readiness/application-modules/current-http-source-projection.json
```

The seven large generated inventories are tracked as lossless `.json.gz` files;
their exact uncompressed working copies stay local for existing evidence pins.
The [artifact manifest](../../tests/readiness/application-modules/inventory-gzip-manifest.tsv)
records raw and gzip SHA-256 values and byte counts. Inspect without expanding
with `gzip -cd path.json.gz | jq '…'`; restore exact raw bytes with
`gzip -cd path.json.gz > path.json`. After regeneration, refresh the affected
compressed artifact with `gzip -n -c path.json > path.json.gz` and update the
manifest. `.gitignore` excludes only these seven generated raw paths.

The generator reads Git objects across all tracked `backend`, `modules`, `capabilities`, `frontend` and `_extensions` runtime roots. Every file is partitioned into included JavaScript/TypeScript, explicit test/generated/vendor/docs exclusion, or non-JavaScript source/resource uncertainty. Included files carry byte length, SHA, owner, imports and router/endpoint helper calls. Registration rows carry source symbol/location, method, local literal or dynamic path, receiver, handler expressions and enclosing construction predicates. Chained methods, literal path arrays, computed methods and regular expressions remain distinct.

Unknown receivers with route-shaped paths are candidates, not promoted route declarations. Mount and middleware rows retain their arguments and predicates; the tool does not infer arbitrary factory/helper data flow, mount reachability or production configuration. Non-JavaScript protocols and dynamically assembled registrations remain explicit uncertainty.

Historical declaration identities use the prior owner/receiver/method/path/guard/handler policy. Exact matches retain old effect classifications, URL projection hints and testcase links, labelled historical. They create no current behavior, safety, installed-live or coverage credit. Unmatched declarations require new review. Local declaration counts cannot be summed into a reachable URL denominator, especially when routers mount more than once.

The companion projection separates local declarations, mount/middleware edges, helper calls and unresolved candidates. It records exact reference/candidate identity intersections and historical testcase links. Its parser-error, source-hash and duplicate-identity guards fail closed. These are syntax identities, not semantic equivalence: moved composition calls can differ in source identity while actual registration behavior agrees. Manual request dispatch and helper data-flow interpretation remain review boundaries.

The `/device` wrapper and its detached device-router declarations must not be counted twice as installed occurrences. `/plex_proxy` is an external all-method delegate rather than a finite local handler inventory. Telegram/provider mounts and opaque middleware require separate configured activation evidence. Current paired task graphs establish only their recorded task configuration. Production's complete method/template denominator remains unknown.

No application modules are imported, services started, or HTTP requests issued by this generator. Parser errors are retained and must be resolved or explicitly scoped before claiming a complete syntax scan. The old `http-source-inventory.json` and its 658/396 historical figures remain historical artifacts.

`project-current-http-evidence.mjs` adds a current task/source/evidence disposition table in `current-http-evidence-projection.json.gz`. Run its `--controls` mode first, then run it without arguments. It uses the pinned current paired graph and durable/private finite API review inputs; these paths must be present from the reviewed evidence package. It never starts an application or issues requests.

Each census site retains local method/path candidates, exact inline handler hashes when they can be joined to the actual task graph, mount orders, construction predicates, scoped accepted request branches, and unresolved entries. Named historical effect evidence is reusable only when the declaration file and every named source/helper SHA still match the current candidate. A source-safe local handler does not establish safe production middleware, configuration, provider branches, or request permission. Reference transitive effects are not silently inherited from candidate evidence. Named/wrapped handlers that lack an exact join remain unresolved rather than being credited by matching a short path.

The table also enumerates every non-HTTP census site with an explicit activation disposition. Current WS, archive job and browser proofs are related only to their exact pinned source files and stated journey scope; they do not prove that every registration in those files ran. Unlinked sites, dynamic registrations, non-JavaScript and hardware protocols remain gaps. Task templates without accepted request branches are a task gap list, not an installed production denominator. Baseline error, unavailable-service, empty/default, metadata-only and populated contracts remain separately labelled; parity-only results do not automatically close healthy-feature gaps.
