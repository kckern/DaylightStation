# Libby Remote Audio Playback Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `libby:loan/77089338/3070848` expand into playable, metadata-rich audiobook parts and play through the existing office-TV Media screen without persisting provider capabilities or media.

**Architecture:** Complete the existing Libby anti-corruption adapter by deriving `website_id` from the authenticated active-loan record. Add a cover use case that depends on injected Libby loan/image gateway capabilities, map its neutral result in the API, and wire everything only in composition. The ordinary content queue and Media AudioPlayer remain the playback path; there is no `playback-hub` dependency.

**Tech Stack:** Node.js 22 ES modules, Express 5, Fetch/Web Streams, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-21-libby-ephemeral-audio-proxy-design.md`

## Global Constraints

- Accept only explicit `libby:loan/<card-id>/<title-id>` identities for active authenticated audiobook loans.
- `data/users/{username}/auth/libby.yml` contains only `token`; derive `website_id` from `chip/sync`.
- Never log or persist JWTs, cookies, signed media URLs, cover-provider URLs, lease handles, or media bytes.
- Reject DRM/encryption and unsupported fulfillment; do not borrow, renew, return, or synchronize upstream progress.
- Follow `docs/reference/core/layers-of-abstraction/ddd-reference.md`: adapters translate provider protocol, applications depend on injected ports, API maps HTTP only, and composition alone wires layers.
- Use the existing Media screen and queue contract; do not introduce a `media` to `playback-hub` domain dependency.
- Do not start a second local backend. Do not commit, merge, deploy, or activate the office TV without the authority required by the local workspace policy.

## Review Focus

- A matched audiobook with missing, empty, or non-scalar `websiteId` must fail closed before the open request.
- A cover redirect to a deceptive suffix, non-HTTPS URL, explicit non-default port, fourth redirect, or non-image response must be rejected and its body cancelled.
- Provider cookies and authorization must not cross origins during cover redirects.
- Returned or expired loans must make both new audio ranges and cover requests unavailable.
- Queue metadata must survive container expansion without exposing either upstream media or artwork URLs.

---

### Task 1: Active-loan translation and `website_id`

**Files:**
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs`

**Interfaces:**
- Consumes: `credentials.getSnapshot(): { token: string, generation: string }` and authenticated `chip/sync` JSON.
- Produces: `getActiveLoan({ cardId, titleId }): Promise<ActiveLibbyLoan>` and `openLoan({ cardId, titleId }): Promise<LibbyFulfillment>`, where `ActiveLibbyLoan` includes `cardId`, `titleId`, `websiteId`, `title`, `subtitle`, `author`, `description`, `coverUrl`, and `expiresAt`.

- [ ] **Step 1: Write failing request and validation tests**

Add cases that capture the open URL and prove it is exactly provider-generated from the matched loan:

```js
it('opens the matched loan with its synchronized website_id', async () => {
  const { client, calls } = clientFixture({ loan: { websiteId: '12' } });
  await client.openLoan({ cardId: '77089338', titleId: '3070848' });
  expect(new URL(calls.find((url) => url.includes('/open/audiobook/'))).searchParams.get('website_id')).toBe('12');
});

it.each([undefined, '', {}, []])('rejects invalid websiteId %p before opening', async (websiteId) => {
  const { client, calls } = clientFixture({ loan: { websiteId } });
  await expect(client.openLoan({ cardId: '77089338', titleId: '3070848' }))
    .rejects.toMatchObject({ code: 'LIBBY_PROVIDER_FAILED' });
  expect(calls.some((url) => url.includes('/open/audiobook/'))).toBe(false);
});
```

- [ ] **Step 2: Run the focused test and confirm red**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs`

Expected: the open request lacks `website_id`, and invalid `websiteId` values reach the open endpoint.

- [ ] **Step 3: Extract exact active-loan translation and add the query parameter**

Implement the public adapter capability and reuse it from `openLoan`:

```js
async getActiveLoan({ cardId, titleId } = {}) {
  const state = await this.sync();
  const loan = (state?.loans || []).find((item) =>
    String(item?.cardId) === String(cardId) && String(item?.id) === String(titleId));
  if (!loan) throw failure('LIBBY_LOAN_NOT_FOUND', 'Libby loan is not active');
  if (loan?.type?.id !== 'audiobook') {
    throw failure('LIBBY_UNSUPPORTED_FULFILLMENT', 'Libby loan is not an audiobook');
  }
  const expiresAt = Date.parse(loan.expireDate || loan.expires || '');
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw failure('LIBBY_LOAN_EXPIRED', 'Libby loan has expired');
  }
  if (!['string', 'number'].includes(typeof loan.websiteId) || !String(loan.websiteId).trim()) {
    throw failure('LIBBY_PROVIDER_FAILED', 'Libby loan is missing website identity');
  }
  return Object.freeze({
    cardId: String(cardId), titleId: String(titleId), websiteId: String(loan.websiteId),
    title: loan.title || 'Libby audiobook', subtitle: loan.subtitle || null,
    author: loan.firstCreatorName || null, description: loan.description || null,
    coverUrl: loan?.covers?.cover510Wide?.href || loan?.covers?.cover300Wide?.href || null,
    expiresAt,
  });
}

const loan = await this.getActiveLoan({ cardId, titleId });
const openUrl = new URL(`open/audiobook/card/${encodeURIComponent(cardId)}/title/${encodeURIComponent(titleId)}`, this.#apiBase);
openUrl.searchParams.set('website_id', loan.websiteId);
const meta = await this.#requestJson(openUrl, { authenticated: true });
```

- [ ] **Step 4: Preserve public metadata in the fulfillment**

Return `subtitle` with the existing author, narrator, description, expiry, and parts. Keep `websiteId` and `coverUrl` inside `getActiveLoan`; `openLoan` must expose neither provider value. The only provider URLs in its result are the internal part capabilities consumed by the lease service.

- [ ] **Step 5: Run the client and stream regression tests**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs backend/src/3_applications/proxy/LibbyStreamService.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Record an uncommitted checkpoint**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only scoped Libby work remains. Commit only after explicit repository authority.

### Task 2: Published content metadata and opaque artwork identity

**Files:**
- Modify: `backend/src/1_adapters/content/media/libby/LibbyAdapter.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyAdapter.test.mjs`

**Interfaces:**
- Consumes: `client.openLoan({ cardId, titleId }): LibbyFulfillment` from Task 1.
- Produces: content items whose `thumbnail` is `/api/v1/proxy/libby/cover/<cardId>/<titleId>` and whose metadata contains `subtitle`, `author`, `narrator`, `parentTitle`, `partIndex`, and `loanExpiresAt`.

- [ ] **Step 1: Write failing metadata and leak-resistance tests**

```js
expect(book).toMatchObject({
  title: 'A Test Book',
  thumbnail: '/api/v1/proxy/libby/cover/123456789/9999999',
  metadata: { subtitle: 'A Subtitle', author: 'Author', narrator: 'Narrator' },
});
expect(parts[0]).toMatchObject({
  thumbnail: '/api/v1/proxy/libby/cover/123456789/9999999',
  metadata: { subtitle: 'A Subtitle', parentTitle: 'A Test Book', partIndex: 0 },
});
expect(JSON.stringify([book, ...parts])).not.toContain('od-cdn.com');
```

- [ ] **Step 2: Run the adapter test and confirm red**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/LibbyAdapter.test.mjs`

Expected: thumbnails are `null` and subtitle is absent.

- [ ] **Step 3: Add one cover path builder and publish metadata**

```js
#coverPath(parsed) {
  return `/api/v1/proxy/libby/cover/${encodeURIComponent(parsed.cardId)}/${encodeURIComponent(parsed.titleId)}`;
}
```

Use this path for both container and parts, add `subtitle` to both metadata shapes, and retain spine ordering with `loan.parts.map(...)`.

- [ ] **Step 4: Run adapter and content-composition tests**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/LibbyAdapter.test.mjs`

Expected: all tests pass and queue items contain no provider artwork URL.

- [ ] **Step 5: Record an uncommitted checkpoint**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Commit only after explicit repository authority.

### Task 3: DDD-safe cover relay

**Files:**
- Create: `backend/src/3_applications/proxy/LibbyCoverService.mjs`
- Create: `backend/src/3_applications/proxy/LibbyCoverService.test.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.mjs`
- Modify: `backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs`
- Modify: `backend/src/4_api/v1/routers/proxy.mjs`
- Modify: `backend/src/4_api/v1/routers/proxy.stream.test.mjs`
- Modify: `backend/src/5_composition/modules/libby.mjs`
- Modify: `backend/src/5_composition/modules/contentApi.mjs`
- Create: `backend/src/5_composition/modules/libby.test.mjs`

**Interfaces:**
- Consumes: application-owned structural port `coverGateway.openCover({ cardId, titleId, signal }): Promise<{ body: ReadableStream, contentType: string, contentLength: string|null, cleanup: Function }>`.
- Produces: `LibbyCoverService.open({ cardId, titleId, signal })` with result kinds `opened`, `gone`, `credential_unavailable`, or `upstream_error`; composition exposes it as `coverService`.

- [ ] **Step 1: Write failing adapter gateway security tests**

Cover all five Review Focus URL classes and credential stripping:

```js
it.each([
  'http://img3.od-cdn.com/a.jpg',
  'https://img3.od-cdn.com.evil.test/a.jpg',
  'https://img3.od-cdn.com:444/a.jpg',
])('rejects cover target %s', async (coverUrl) => {
  const { client } = clientFixture({ loan: { websiteId: '12', covers: { cover510Wide: { href: coverUrl } } } });
  await expect(client.openCover({ cardId: '77089338', titleId: '3070848' }))
    .rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
});
```

Also assert at most three redirects, cancelled rejected bodies, `image/*` content type, and removal of `Cookie`/`Authorization` when origin changes.

- [ ] **Step 2: Run the client test and confirm red**

Run: `npx vitest run backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs`

Expected: `openCover` does not exist.

- [ ] **Step 3: Implement the adapter-owned image gateway**

Add a distinct `coverAllowedHosts` constructor option and an `openCover` method that calls `getActiveLoan`, validates HTTPS/default-port hosts, follows at most three manual redirects, strips credentials across origins, rejects non-`image/*`, and returns only the neutral stream result. It must never return `coverUrl` to API code.

- [ ] **Step 4: Write the failing application mapping tests**

```js
it('maps a returned loan to gone', async () => {
  const coverGateway = { openCover: vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { code: 'LIBBY_LOAN_NOT_FOUND' })) };
  const service = new LibbyCoverService({ coverGateway });
  await expect(service.open({ cardId: '1', titleId: '2' })).resolves.toEqual({ kind: 'gone' });
});
```

Add credential, provider, cancellation, and successful neutral-result cases.

- [ ] **Step 5: Run the application test and confirm red**

Run: `npx vitest run backend/src/3_applications/proxy/LibbyCoverService.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 6: Implement the application use case without adapter imports**

```js
export class LibbyCoverService {
  constructor({ coverGateway } = {}) {
    if (!coverGateway?.openCover) throw new Error('LibbyCoverService requires coverGateway');
    this.coverGateway = coverGateway;
  }
  async open(input) {
    try { return { kind: 'opened', ...(await this.coverGateway.openCover(input)) }; }
    catch (error) {
      if (['LIBBY_LOAN_NOT_FOUND', 'LIBBY_LOAN_EXPIRED'].includes(error?.code)) return { kind: 'gone' };
      if (error?.code === 'LIBBY_CREDENTIAL_UNAVAILABLE') return { kind: 'credential_unavailable' };
      return { kind: 'upstream_error' };
    }
  }
}
```

- [ ] **Step 7: Write failing API translation tests**

Assert `200` image streaming with `Cache-Control: private, no-store` and `nosniff`, `410` for gone, `401` for unavailable credentials, `502` for provider failure, `503` when unwired, and abort/cancel cleanup on disconnect.

- [ ] **Step 8: Add the thin route and composition wiring**

Add `GET /libby/cover/:cardId/:titleId` to `createProxyRouter`. It calls only injected `libbyCoverService.open`, maps result kinds, copies `Content-Type`/optional `Content-Length`, streams with backpressure, and calls cleanup. In `createLibbyRuntime`, construct `LibbyCoverService({ coverGateway: client })`; thread `coverService` through `contentApi` to the router. Add `.od-cdn.com` to a dedicated cover allowlist rather than the audio list.

- [ ] **Step 9: Run behavior and DDD gates**

Run:

```bash
npx vitest run backend/src/1_adapters/content/media/libby/LibbyClient.test.mjs backend/src/3_applications/proxy/LibbyCoverService.test.mjs backend/src/4_api/v1/routers/proxy.stream.test.mjs backend/src/5_composition/modules/libby.test.mjs
npm run audit:layers
npm run audit:fs
npm run test:composition-contracts
```

Expected: all tests and audits pass with no application-to-adapter, API-to-application, or direct-filesystem violation.

- [ ] **Step 10: Record an uncommitted checkpoint**

Run: `git diff --check && git status --short`

Expected: no whitespace errors. Commit only after explicit repository authority.

### Task 4: Queue contract, documentation, and live provider proof

**Files:**
- Modify: `backend/src/5_composition/modules/libby.test.mjs`
- Modify: `docs/reference/media/README.md`
- Modify: `docs/reference/media/media-app-technical.md`
- Modify: `.superpowers/sdd/2026-09-21-libby-ephemeral-audio-proxy/progress.md`

**Interfaces:**
- Consumes: the content registry, Libby runtime, and proxy services completed above.
- Produces: a queue contract compatible with the standard Media screen and an evidence ledger for deployment acceptance.

- [ ] **Step 1: Write the failing composition-level queue test**

Exercise the real adapter registration with fake provider responses and assert:

```js
expect(items.map(({ mediaType }) => mediaType)).toEqual(items.map(() => 'audio'));
expect(items.map(({ thumbnail }) => thumbnail)).toEqual(items.map(() => '/api/v1/proxy/libby/cover/77089338/3070848'));
expect(items[0]).toMatchObject({
  title: 'Part 1',
  metadata: { parentTitle: 'Forensic History', subtitle: 'Crimes, Frauds, and Scandals', partIndex: 0 },
});
expect(JSON.stringify(items)).not.toMatch(/listen\.libbyapp\.com|od-cdn\.com|Bearer /);
```

- [ ] **Step 2: Run the composition test and confirm red**

Run: `npx vitest run backend/src/5_composition/modules/libby.test.mjs`

Expected: missing metadata/cover assertions fail before Tasks 1–3 are complete.

- [ ] **Step 3: Update durable media documentation**

Document `website_id` derivation, metadata fields, `/api/v1/proxy/libby/cover/:cardId/:titleId`, private/no-store artwork, standard remote Media queue dispatch, and the explicit absence of a Playback Hub dependency. Keep instance-specific IDs, hosts, usernames, and filesystem paths out of reference docs.

- [ ] **Step 4: Run focused and broad verification**

Run:

```bash
npm run check:parse
npx vitest run backend/src/1_adapters/content/media/libby backend/src/3_applications/proxy/LibbyStreamService.test.mjs backend/src/3_applications/proxy/LibbyCoverService.test.mjs backend/src/4_api/v1/routers/proxy.stream.test.mjs backend/src/5_composition/modules/libby.test.mjs
npm run audit:layers
npm run audit:fs
npm run test:composition-contracts
npm run test:backend
git diff --check
```

Expected: focused suites and architecture gates pass. Any broad pre-existing failure must be demonstrated against the untouched baseline before being classified as unrelated.

- [ ] **Step 5: Perform a sanitized live-provider probe**

Use the real credential file only through `LibbyCredentialProvider`; call `client.openLoan({ cardId: '77089338', titleId: '3070848' })` and `client.openCover(...)`. Record only title, part count, duration, MIME type, and success/failure—never the token, cookie, signed URL, cover-provider URL, or response bytes.

Expected: the open request succeeds using synchronized `website_id`, at least one MP3 part is returned, and the cover reports an `image/*` type.

- [ ] **Step 6: Update the progress ledger and stop at the deployment gate**

Record exact verification commands and sanitized outcomes. Do not commit, merge, deploy, or call the state-changing office-TV load endpoint without the authority required by workspace policy.

### Task 5: Deployment and exact office-TV acceptance (authorization-gated)

**Files:** No source edits expected.

**Interfaces:**
- Consumes: an integrated/deployed build containing Tasks 1–4.
- Produces: evidence that the user's exact Daylight endpoint starts standard Media playback and queues the remaining audiobook parts.

- [ ] **Step 1: After explicit authorization, commit and integrate the verified branch**

Use the repository's direct-main workflow, preserving unrelated user changes. Do not create a pull request.

- [ ] **Step 2: Deploy using the workspace's documented production procedure**

Read `.claude/settings.local.json` and `CLAUDE.local.md` for the actual host/container and permitted workflow. Do not print credentials or environment-specific values.

- [ ] **Step 3: Verify deployed read-only endpoints first**

Request the deployed list and cover endpoints for `libby:loan/77089338/3070848`. Confirm ordered audio entries, same-origin artwork, expected metadata, and successful byte-range behavior before touching the device.

- [ ] **Step 4: Invoke the exact authorized device endpoint once**

Request:

```text
https://daylightlocal.kckern.net/api/v1/device/office-tv/load?queue=libby:loan/77089338/3070848
```

Expected: the existing warm websocket or cold Media screen path loads the first audio part and retains the rest of the ordered queue.

- [ ] **Step 5: Inspect sanitized device/session evidence**

Verify the office-TV Media session identifies the book, reports audio playback/progress, displays the cover, and has subsequent parts queued. Inspect structured logs only for status and redaction; never print provider capabilities.

- [ ] **Step 6: Run final verification and close the goal**

Run the focused post-deployment smoke plus `git diff --check`. Mark the goal complete only when the exact office-TV acceptance behavior is observed; otherwise keep diagnosing within scope.
