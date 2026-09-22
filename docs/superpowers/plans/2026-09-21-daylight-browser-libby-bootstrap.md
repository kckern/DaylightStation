# DaylightBrowser Libby Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a containerized Playwright extension that runs Libby's official authorized bootstrap, returns a normalized ephemeral audiobook spine, and enables the exact office-TV queue endpoint.

**Architecture:** `_extensions/daylight-browser` owns Chromium behind a provider-neutral typed-operation registry; it exposes no arbitrary navigation or proxy surface. Libby contributes the first operation, `POST /v1/operations/libby.bootstrap-loan`, with its own schema and network policy. A backend adapter calls that private operation through an application-owned bootstrap port; future YouTube or other providers add independent operations, policies, ports, and gateways without modifying Libby code.

**Tech Stack:** Node.js 22 ES modules, Express, Playwright 1.63.0, Chromium, Docker Compose, Vitest/Node test.

**Spec:** `docs/superpowers/specs/2026-09-21-libby-ephemeral-audio-proxy-design.md`

## Global Constraints

- Extension path is `_extensions/daylight-browser`, deployed independently like `_extensions/fitness`.
- Base image and npm package are both pinned to Playwright `1.63.0`; image is `mcr.microsoft.com/playwright:v1.63.0-noble`.
- Expose no arbitrary URL/browser/evaluate/proxy endpoint and publish no host port.
- Shared browser-pool code is provider-neutral; provider schemas, origins, interception rules, normalization, and redaction live in separate operation modules.
- Do not mount Libby credentials or Daylight data into the extension.
- Use one ephemeral context per request; persist no profile, cookie, cache, download, signed URL, or media byte.
- Block analytics, reporting, activity mutation, and unrelated navigation. During the media phase, request-stage CDP enforcement permits only exact shell/CDN GET Media traffic for a fixed 20-second observation window under a 30-second hard deadline. Authorized bytes may exist only in the bounded ephemeral player context and are never read, returned, or persisted.
- Reject encrypted/licensed/non-MP3 spines; do not reverse-engineer provider decoding or bypass DRM.
- Keep provider capabilities inside adapters and existing process-local leases; queue/API results remain opaque.
- Follow `docs/reference/core/layers-of-abstraction/ddd-reference.md`; only composition wires the backend gateway.
- Do not commit, merge, or deploy until the corresponding authorization gate. The user has explicitly authorized deployment to the existing DaylightStation stack on `homeserver.local` after verification.

## Review Focus

- A caller-controlled URL cannot turn the extension into SSRF; request identity must match the configured Libby HTTPS origins and exact operation schema.
- Before provider navigation, install non-configurable throwing `Worker` and `SharedWorker` constructors plus sealed blocking facades for `BaseAudioContext.prototype.audioWorklet` and every exposed page worklet loader (`paint`, `layout`, `animation`, including equivalent global surfaces) in every frame realm; keep `HTMLAudioElement`, ordinary CSS/layout APIs, and context-blocked service workers intact. Keep one context-wide route installed throughout the operation. It atomically flips from the pinned bootstrap policy to a media policy only after original-page CDP is enabled; media policy permits only original-page/main-frame exact shell/CDN GET Media requests and aborts popup/extra-page navigation, routable worker traffic, navigation, non-media, and foreign requests pre-egress. Original-page CDP remains authoritative for redirects/capture. Cleanup flips the route to block-all before target closure.
- Timeout, disconnect, browser crash, and malformed bootstrap data must abort operation-owned work, close the context, and release the one-operation concurrency slot only after bounded settlement; ignored cancellation poisons the pool.
- The normalized spine must contain stable ordered MP3 parts without returning cookies, page storage, tokens, or unrelated page state.
- A sidecar outage must fail closed and must not weaken the legacy openbook origin/DRM checks.

---

### Task 1: Narrow DaylightBrowser extension

**Files:**
- Create: `_extensions/daylight-browser/package.json`
- Create: `_extensions/daylight-browser/package-lock.json`
- Create: `_extensions/daylight-browser/Dockerfile`
- Create: `_extensions/daylight-browser/docker-compose.yaml`
- Create: `_extensions/daylight-browser/src/server.mjs`
- Create: `_extensions/daylight-browser/src/browserPool.mjs`
- Create: `_extensions/daylight-browser/src/operationRegistry.mjs`
- Create: `_extensions/daylight-browser/src/operations/libby/bootstrapLoan.mjs`
- Create: `_extensions/daylight-browser/src/operations/libby/securityPolicy.mjs`
- Create: `_extensions/daylight-browser/test/operationRegistry.test.mjs`
- Create: `_extensions/daylight-browser/test/bootstrapLoan.test.mjs`
- Create: `_extensions/daylight-browser/test/server.test.mjs`

**Interfaces:**
- Consumes: `POST /v1/operations/libby.bootstrap-loan` body `{ webUrl: string, message: string, operationId: string }`.
- Produces: `{ title, subtitle, author, narrator, duration, parts: [{ key, index, title, duration, contentLength, mimeType, upstreamUrl, headers }] }`; `headers` is always an empty object unless the official bootstrap proves a scoped media cookie is required.

- [ ] **Step 1: Write failing policy and bootstrap tests**

Use an injected fake browser/page and assert registry rejection of unknown operations, exact Libby HTTPS host rules, one context per call, blocked request categories, no downloads/popups, timeout cleanup, one-operation concurrency, ordered MP3 normalization, and rejection of encryption/license/non-MP3 data.

```js
await expect(bootstrapLoan({ webUrl: 'https://evil.test/', message: 'm=x', operationId: 'op-1' }, deps))
  .rejects.toMatchObject({ code: 'BROWSER_ORIGIN_REJECTED' });
expect(result.parts.map(({ index, mimeType }) => [index, mimeType]))
  .toEqual([[0, 'audio/mpeg'], [1, 'audio/mpeg']]);
expect(fake.context.close).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run RED**

Run: `npm test --prefix _extensions/daylight-browser`

Expected: module-not-found failures.

- [ ] **Step 3: Implement the typed operation and server**

The server dispatches an exact registered operation name and delegates to its schema, security policy, and handler. The Libby handler validates the three-field JSON body, loads `webUrl` with `message` as its raw query, waits until the official player exposes a nonempty normalized book map, reads only metadata/spine fields, and closes the context in `finally`. Return categorical `400`, `404`, `409`, `422`, `502`, and `504` errors without provider detail.

- [ ] **Step 4: Add the pinned container**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
USER pwuser
CMD ["node", "src/server.mjs"]
```

Compose with `read_only: true`, `tmpfs: [/tmp, /home/pwuser/.cache]`, `cap_drop: [ALL]`, `init: true`, internal network only, healthcheck, memory/CPU limits, and no `ports`, `volumes`, or credential environment variables.

- [ ] **Step 5: Run GREEN and container smoke**

Run:

```bash
npm test --prefix _extensions/daylight-browser
docker compose -f _extensions/daylight-browser/docker-compose.yaml config
docker build -t daylight-browser:test _extensions/daylight-browser
```

Expected: tests pass, compose renders, image builds as `pwuser`.

- [ ] **Step 6: Record uncommitted checkpoint**

Run: `git diff --check && git status --short`. Do not commit before the repository gate.

### Task 2: Backend bootstrap port and gateway

**Files:**
- Create: `backend/src/3_applications/proxy/LibbyBootstrapService.mjs`
- Create: `backend/src/3_applications/proxy/LibbyBootstrapService.test.mjs`
- Create: `backend/src/1_adapters/content/media/libby/DaylightBrowserLibbyGateway.mjs`
- Create: `backend/src/1_adapters/content/media/libby/DaylightBrowserLibbyGateway.test.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs`
- Modify: `backend/src/5_composition/modules/libby.mjs`
- Modify: `tests/isolated/assembly/infrastructure/libby-runtime.test.mjs`

**Interfaces:**
- `LibbyBootstrapService.open(input)` consumes `{ webUrl, message, operationId }` and returns the neutral normalized spine or categorical failure.
- `DaylightBrowserLibbyGateway.bootstrapLoan(input, { signal })` calls the sidecar base URL configured in composition.
- `LibbyClient.openLoan()` retains legacy openbook behavior when explicitly supplied and otherwise calls the injected bootstrap service.

- [ ] **Step 1: Write failing gateway/service tests**

Assert exact path/method/body, private base URL validation, timeout/abort, response size/type/schema limits, redacted errors, and rejection of any extra capability fields.

```js
expect(fetch).toHaveBeenCalledWith('http://daylight-browser:3000/v1/operations/libby.bootstrap-loan', expect.objectContaining({ method: 'POST' }));
expect(JSON.stringify(result)).not.toMatch(/cookie|token|storage/i);
```

- [ ] **Step 2: Run RED, implement gateway/service, run GREEN**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/DaylightBrowserLibbyGateway.test.mjs backend/src/3_applications/proxy/LibbyBootstrapService.test.mjs`.

- [ ] **Step 3: Write failing LibbyClient fallback tests**

Cover legacy-openbook preference, missing-openbook bootstrap fallback, sidecar outage, malformed sidecar spine, DRM rejection, stable part keys, and absence of raw capabilities from public fulfillment.

- [ ] **Step 4: Implement fallback and composition wiring**

Inject `bootstrapService` and a generated categorical `operationId`; never pass JWT or credential path to the sidecar. Configure the private base URL only in `5_composition`.

- [ ] **Step 5: Run behavior and DDD gates**

```bash
npx vitest run backend/src/1_adapters/content/media/libby backend/src/3_applications/proxy/LibbyBootstrapService.test.mjs tests/isolated/assembly/infrastructure/libby-runtime.test.mjs
npm run audit:layers
npm run audit:fs
npm run test:composition-contracts
git diff --check
```

Expected: all focused tests and audits pass without new baselines.

### Task 3: Live sidecar integration and documentation

**Files:**
- Create: `_extensions/daylight-browser/test/live/libby-bootstrap.live.mjs`
- Modify: `docs/reference/media/README.md`
- Modify: `docs/reference/media/media-app-technical.md`
- Create: `docs/runbooks/daylight-browser.md`

**Interfaces:**
- Consumes: real credential only in the Daylight backend; sidecar receives one-use web bootstrap capability.
- Produces: sanitized proof of title, part count, total duration, MIME types, cover MIME, and successful first-byte range through the existing proxy without printing bytes or URLs.

- [ ] **Step 1: Add opt-in live harness**

The harness requires explicit environment variables and prints only `{ success, title, partCount, duration, mimeTypes, coverMimeType }`. It cancels every opened body immediately and destroys the context.

- [ ] **Step 2: Run local container integration**

Start only the sidecar container, run the backend-side probe without starting another backend, and verify the exact current loan returns at least one MP3 part. Stop and remove the test container afterward.

- [ ] **Step 3: Update docs and run full verification**

Document sidecar ownership, configuration, health, failure modes, update procedure, and security boundary without instance-specific hostnames or paths. Run parse, focused suites, architecture audits, composition contracts, backend suite, extension tests, compose config, and `git diff --check`.

- [ ] **Step 4: Request whole-branch review**

The review must inspect the extension policy, backend boundary, request blocking, cleanup, redaction, DDD imports, and live sanitized evidence.

### Task 4: Commit, deploy, and exact office-TV acceptance

**Files:** No new product files expected.

**Interfaces:**
- Consumes: reviewed branch and existing production stack on `homeserver.local`.
- Produces: deployed Daylight backend plus internal DaylightBrowser service and observed office-TV playback.

- [ ] **Step 1: Commit and integrate after review**

Commit the verified scoped changes, merge directly into main under the repository workflow, and preserve unrelated user changes.

- [ ] **Step 2: Inspect the existing remote stack read-only**

Use `ssh homeserver.local` to identify the existing DaylightStation compose project, network, configuration injection, architecture, and deployment procedure. Do not print secrets.

- [ ] **Step 3: Build and deploy the pinned sidecar**

Build for the remote architecture, add it to the existing private stack/network with no published port or credential mount, deploy the reviewed backend configuration, and wait for both healthchecks.

- [ ] **Step 4: Verify deployed read-only contracts**

Verify sidecar health, Libby queue expansion, cover, metadata, and a single byte range through Daylight. Inspect only sanitized structured logs.

- [ ] **Step 5: Invoke the exact authorized device endpoint once**

```text
https://daylightlocal.kckern.net/api/v1/device/office-tv/load?queue=libby:loan/77089338/3070848
```

Expected: office-TV Media plays the first part with cover/metadata and retains remaining parts.

- [ ] **Step 6: Confirm playback and finish**

Verify session progress and queued successors, run post-deployment smoke, record sanitized evidence, and mark the goal complete only after observed playback.
