# Isolated differential boot recipe (not executed)

Docker access is currently unavailable. The existing Landlock product profile denies sockets and listening; the memory HTTP test adapters do not establish real-server equivalence. This recipe requires an independently authorized container builder/runtime. Do not weaken that profile or touch production containers, networks, volumes, providers, credentials, mounts or ports. An approved host Docker daemon may build/run task-owned isolated containers; daemon access itself is not forbidden.

## Freeze the two inputs

Resolve latest main and the migrated revision to full commits before execution. Copy each reviewed tracked source universe into a separate sanitized build context, preserving bytes/modes and recording SHA-256. Reuse the enumeration/hash/copy approach in `tests/preimplementation/application-modules/tooling/run-landlock-build.mjs`; its frontend-only input universe is insufficient for a Docker image.

Cover every `docker/Dockerfile` COPY root: root/frontend/backend package locks, the two installation/setup scripts, shared, backend, frontend, modules, capabilities, CLI, and entrypoint. Verify actual Docker ignore semantics against required moved YAML, Sass, native/runtime assets and dynamic file reads. Root `.dockerignore` contains legacy curriculum/fitness resource exceptions; Docker context coverage must be checked, not inferred from Git coverage. Never include `.env`, private/untracked config, data, media, SSH/ADB keys or sockets.

Build both with identical resolved base-image and dependency inputs. The existing Dockerfile uses Node 22.23.2 Alpine, network package installation, moving yt-dlp Git HEAD and unpinned global forever. Record/pin the actual resolved inputs for both builds; two independent moving downloads cannot establish a differential result. No host install or downloaded install target is authorized by this document.

## Synthetic boot data

Use one frozen, hashed synthetic fixture seed and two independent writable copies. Real Docker `serverMain` resolves `/usr/src/app/data/system/config` regardless of DAYLIGHT_DATA_PATH. The existing test compose mounts `/data` and read-only demo data, so it is not the fixture recipe.

Required schema layout:

- `data/system/config/system.yml`: explicit Docker app port, timezone, default household.
- `data/household/household.yml`: one synthetic head and users list.
- `data/users/<synthetic-user>/profile.yml`: matching user profile.
- `data/system/config/auth.yml`: explicit synthetic roles/token secret; domains as needed for actual resolver/auth cases.
- Empty/disabled synthetic integrations, services, adapters and hardware devices; use registered household app-config paths rather than legacy directories.

Schema validity alone does not prove full startup. Any additional required empty app config discovered during real boot must be added identically to both fixture seeds and its necessity recorded. Do not reuse the household-demo generator unchanged: it configures Plex/Home Assistant providers and its members layout differs from loader requirements. Do not reuse configHelper/testServer that reads repository `.env` or live data.

## Container phases

Build each sanitized context with `docker build -f <context>/docker/Dockerfile --build-arg COMMIT_HASH=<full-revision> -t daylight-smoke:<unique-revision> <context>` on the approved isolated builder. Tag/container names must never match production.

First boot the actual entry with an explicit entrypoint: `node /usr/src/app/backend/index.js`, NODE_ENV=production, DAYLIGHT_ENV=docker and DAYLIGHT_BASE_PATH=/usr/src/app. Require network none, no published ports, dropped capabilities, no-new-privileges, node user, read-only image filesystem, private writable fixture at `/usr/src/app/data`, private media at `/usr/src/app/media`, and private `/tmp`. Additional write paths must be individually justified by observed startup, not broad host mounts.

Use real loopback HTTP within the isolated namespace. A comparator runner sharing only that network namespace may reach the two explicit isolated targets; loopback URLs alone are not isolation proof. This comparator requires both apps and the runner in ONE approved task-owned network namespace with distinct synthetic config ports and no nonlocal routes. Separate network-none namespaces are not directly compatible with this CLI; topology remains unexecuted until the approved runtime provides that shared isolated namespace. Do not publish them on the host as an implicit workaround. Browser verification needs an actual isolated browser in the approved namespace, not HTML fetch alone.

Direct-node boot does not certify production entrypoint. In a separate phase test `docker/entrypoint.sh` with only synthetic scratch files: it forces Docker env, changes data/media ownership, reads SSH/ADB files, copies payloads and invokes `su-exec node forever index.js`. Observe permissions, process supervision, startup failure and shutdown explicitly.

Retain real scheduler/MQTT defaults identically unless a separate reduced-scope mode is labeled. `serverMain` does not disable them, and createApp has additional timers outside scheduler control. No provider credentials/devices plus network isolation must prevent external effects; do not describe imported-module mocks as full boot.

## Selected HTTP comparator

`node tests/readiness/application-modules/api-comparator.mjs tests/readiness/application-modules/api-expectations.json <isolated-targets.json>`

The targets file has no defaults: `{ "isolated": true, "reference": { "url": "http://127.0.0.1:<explicit-port>", "fixtureSha256": "<64-hex-seed-hash>", "sourceCommit": "<40-hex-commit>", "imageDigest": "sha256:<64-hex-image-digest>" }, "candidate": { "url": "http://127.0.0.1:<different-explicit-port>", "fixtureSha256": "<same-seed-hash>", "sourceCommit": "<40-hex-commit>", "imageDigest": "sha256:<64-hex-image-digest>" } }`. This is an operator assertion, not independently verified Docker isolation. Preserve image IDs, namespace policy and fixture staging receipt alongside comparator results.

Only GET/HEAD, manual redirect handling, five-second requests and a 1 MiB response ceiling are supported. Cases require a reviewed read-only/local/finite safety disposition, an explicit non-5xx status, headers and exact text or required JSON types plus expected values. HEAD requires text exact empty. Unreviewed, blocked, side-effectful, provider and stream cases reject before transport. The reviewed safety.sideEffects:false disposition means no meaningful application-state, provider or device effects; ordinary request logs and metrics confined to the isolated fixture are permitted. Image digests and source commits are declarations in this increment until independently checked against image inspect/build evidence; the report retains them. Request auth headers are not supported in this initial unauthenticated-only comparator. JSON bodies must be top-level objects, and required strings must be nonempty; top-level arrays, nested schemas, nullable strings, binary/range responses and authenticated role cases remain unsupported until concrete reviewed cases require them. Every side independently satisfies expectations before differential comparison. Normalization is explicitly listed per case; no arbitrary key removal or matching-error acceptance. `accepted` applies only to selected cases, and `readinessAccepted` always remains false.

Initial expectations cover Node liveness and Express ping, including COOP/COEP on Express. They do not cover authentication, household/device trust, endpoint-specific bodies, writes/events, WS, jobs, browser or lifecycle. Expand only from the reviewed HTTP inventory with explicit fixtures/expectations. Observe real SIGTERM flush/stop behavior for progress, Hub, DoNow, School/Fitness producers; collect exit status and fixture side effects rather than certifying shutdown from scheduler disposal alone.

Synthetic comparator controls: `node --test tests/readiness/application-modules/comparator-controls.test.mjs`. These require no sockets, app boot or Docker and cannot qualify container readiness.


## Live reference with a local candidate

Docker is optional for the current read-only baseline. Use `mode: "live-reference"`,
`readOnlyReference: true`, and explicit distinct loopback URLs. Record the observed
reference `sourceCommit`; do not assume it matches current main. The candidate
requires `sourceCommit`, a hash of its actual `workingTreeSha256`, its
`fixtureSha256`, and `isolated: true`. These fields are declared evidence pointers,
not automatic runtime verification. Independently verify the running process,
storage isolation, disabled autonomous effects, and source/config identities.

Declare `dataRelationship: { kind: "independent-snapshot", description: "..." }`
when the datasets differ. This does not relax comparisons: data-dependent
responses still fail equality and need a documented explanation or a matching
safe snapshot. `matched-snapshot` requires equal explicit fixture hashes on both
targets. Local processes do not require image digests. The original isolated-image
mode remains available unchanged.

Only individually reviewed finite GET/HEAD cases are accepted in either mode.
The transport sends no cookies or bearer identity and follows no redirects.
Keep result files private: observations and assertion diffs can contain household
data. Persist only sanitized counts and findings in repository evidence.


## Reusable local execution

The repository runner is `tests/readiness/application-modules/run-local-app.mjs`.
It requires Linux with the supported Landlock/seccomp interfaces, GCC, Node, and
existing canonical dependencies/native libraries. It fails if isolation cannot
be established; do not rerun it without confinement to work around a failure.

Set `SOURCE_ROOT` to the isolated candidate checkout, `TOOL_ROOT` to the checkout
holding the installed canonical dependencies, and `OUTPUT_ROOT` to an existing
private directory outside the source tree. Use absolute paths. Configure the
live reference origin from the machine's local settings, not a guessed port.
The candidate test listener is fixed by the confinement policy to
`http://127.0.0.1:43129`; a busy port is a failure, not permission to reuse it.

First verify confinement without any business API requests:

```sh
node "$SOURCE_ROOT/tests/readiness/application-modules/run-local-app.mjs" \
  --source-root "$SOURCE_ROOT" --tool-root "$TOOL_ROOT" \
  --output-root "$OUTPUT_ROOT" --controls-only
```

Create a private target JSON file using the live-reference schema above. Its
reference must identify the observed live source revision; its candidate must
identify the checkout revision and declare isolation. The runner supplies the
actual candidate source-input and fixture fingerprints. Select the independent
snapshot relationship for the initial authored/default cases; data differences
still fail comparisons.

Run the first reviewed suite:

```sh
node "$SOURCE_ROOT/tests/readiness/application-modules/run-local-app.mjs" \
  --source-root "$SOURCE_ROOT" --tool-root "$TOOL_ROOT" \
  --output-root "$OUTPUT_ROOT" \
  --manifest "$SOURCE_ROOT/tests/readiness/application-modules/first-readonly-expectations.json" \
  --targets "$TARGETS_FILE"
```

An optional `--fixture "$FIXTURE_FILE"` supplies a reviewed private configuration
projection. The fixed synthetic authentication, secrets, service, integration
and device files must remain unchanged. Never mount writable live data. Do not
populate expectations by copying the response being tested: derive meaningful
expected values from independently reviewed configuration/contracts.

The runner uses a 30-second listener window within a 45-second process bound.
Use small reviewed case packs; this is not one unconstrained request sweep over
the whole inventory. Slow or oversized responses, startup failures and expired
windows remain failures. Increase capacity only through an explicit bounded
runner change with resource/isolation checks.

A successful run must have exit code zero, a completed receipt, passing isolation
controls, unchanged protected inputs and `comparisonAccepted: true`. A boot-only
run can complete without making comparisons; it earns no API coverage. Reports
retain `readinessAccepted: false`: accepting selected cases never certifies the
whole migration. Keep raw reports private and update route/case coverage with
sanitized evidence links, including failed baseline contracts and unresolved
routes. Preserve the exact source, fixture, expectations and harness identities
for later replay.
