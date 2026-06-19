# Online Stream Sources (`stream:` content source) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make `https://daylightlocal.kckern.net/api/v1/device/<screenid>/load?play=stream:https://soccerfull.net/play/14360` resolve an arbitrary online page to a playable stream and render it on the screen.

**Architecture:** A new vendor-blind `stream` content source plugs into the existing `ContentSourceRegistry` → `/api/v1/play` → `SinglePlayer` pipeline. `StreamAdapter` owns no site knowledge; it dispatches a URL to an ordered list of `IStreamResolver` strategies (`scrape`, `ytdlp`, `iframe`). Every site specific (hosts, regexes, headers) lives in **YAML profiles** under `data/system/config/streaming/*.yml` — never in `.mjs`. The resolver decides a `format` server-side: `video` (native), `hls_video` (hls.js), or `webview` (iframe). HLS/MP4 from third-party CDNs is piped through a backend stream proxy so headers/CORS are handled server-side.

**Tech Stack:** Node ESM (`node:test` for backend unit tests, colocated `*.test.mjs`, run with `node --test <file>`), React (vitest for frontend), yt-dlp (already in Docker + `backend/src/1_adapters/media/YtDlpAdapter.mjs`), hls.js (already a root dependency; must be added to `frontend/`).

**DDD constraints (hard):**
- Vendor names (`yt-dlp`, `soccerfull`, regexes, hosts) appear ONLY inside `backend/src/1_adapters/` or in `.yml` config. Never in domain/application/api layers.
- Dependency rule: `1_adapters` may import `2_domains` + `3_applications` ports only; the port `IStreamResolver` lives in `3_applications/content/ports/`.
- See `docs/reference/core/layers-of-abstraction/ddd-reference.md`.

---

## Key facts discovered (read before starting)

- **Resolution pipeline:** `ContentSourceRegistry` (`backend/src/2_domains/content/services/ContentSourceRegistry.mjs`) maps a source prefix → adapter. `ContentIdResolver` splits `compoundId` on the first `:` → `{ source, localId }`. Adapters are registered in `backend/src/0_system/bootstrap.mjs` (~line 486-744) via `registry.register(adapter, { category, provider })`.
- **Adapter contract** (`backend/src/3_applications/content/ports/IContentSource.mjs`): must expose `get source()`, `get prefixes()`, and methods `getItem(id)`, `getList(id)`, `resolvePlayables(id)`, `resolveSiblings(compoundId)`. Validated by `validateAdapter` (`backend/src/2_domains/content/services/validateContentSource.mjs`).
- **Format dispatch:** `/api/v1/play/...` → `PlayResponseService.toPlayResponse(item, ...)` (`backend/src/3_applications/content/services/PlayResponseService.mjs:53`). `format` comes from `resolveFormat(item, adapter)` (`backend/src/2_domains/content/utils/resolveFormat.mjs`), whose **first priority is `item.metadata.contentFormat`**. So a stream item sets `metadata.contentFormat` (`video`/`hls_video`/`webview`) and `mediaUrl`.
- **Frontend dispatch:** `SinglePlayer.renderByFormat()` (`frontend/src/modules/Player/components/SinglePlayer.jsx`): `isMediaFormat(format)` → `VideoPlayer`/`AudioPlayer`/`ImageFrame`; else `getRenderer(format)` from `frontend/src/modules/Player/lib/registry.js`. `VideoPlayer.jsx` picks `<dash-video>` when `media.mediaType === 'dash_video'`, else native `<video>`.
- **URL-safety gotcha:** `fetchMediaInfo` (`frontend/src/modules/Player/lib/api.js`) builds `api/v1/play/${contentId}` **unencoded**. A raw `stream:https://host/a/b` would be mangled by Express path routing (`://`, `/`). Therefore the canonical token is **base64url** of the URL: `stream:<base64url>`. The raw `stream:<url>` form (from the goal URL) is normalized to the token form in `api.js` before the request; `StreamAdapter` decodes it back.
- **Proxy infra:** `backend/src/4_api/v1/routers/proxy.mjs` already streams Plex/media with range support — the new stream proxy follows its patterns.
- **Reuse:** `backend/src/1_adapters/media/YtDlpAdapter.mjs` (yt-dlp wrapper). `backend/src/1_adapters/feed/WebContentAdapter.mjs` (HTML fetch w/ UA) is a reference for fetch-based scraping.

---

## Phasing overview

0. Worktree + design doc commit
1. Domain: format constants, `StreamResult`, `StreamProfile` value objects
2. Application: `IStreamResolver` port
3. System: `ConfigService.getStreamingProfiles()` (glob `streaming/*.yml`)
4. Adapters: `IframeStreamResolver`, `ScrapeStreamResolver`, `YtDlpStreamResolver`
5. Adapter: `StreamAdapter` (IContentSource) + base64url codec
6. Wiring: bootstrap registration (`stream` prefix)
7. API: backend stream proxy (`/api/v1/proxy/stream`) — header injection + m3u8 rewrite
8. Frontend: base64url normalization, hls.js dep, `VideoPlayer` HLS branch, `WebViewRenderer`, registry + media-set
9. Config: author `soccerfull.yml` profile
10. End-to-end verification against the goal URL

Commit after every task.

---

## Task 0: Worktree + commit the design

**Step 1:** From repo root, create an isolated worktree (see superpowers:using-git-worktrees):
```bash
git worktree add ../DaylightStation-stream -b feat/stream-sources
cd ../DaylightStation-stream
```

**Step 2:** This plan already lives at `docs/plans/2026-06-19-online-stream-sources.md`. Confirm it is present, then commit.
```bash
git add docs/plans/2026-06-19-online-stream-sources.md
git commit -m "docs: plan for online stream sources"
```

---

## Task 1: Domain value objects — formats, StreamResult, StreamProfile

**Files:**
- Create: `backend/src/2_domains/content/value-objects/StreamFormat.mjs`
- Create: `backend/src/2_domains/content/value-objects/StreamResult.mjs`
- Create: `backend/src/2_domains/content/value-objects/StreamProfile.mjs`
- Test: `backend/src/2_domains/content/value-objects/StreamProfile.test.mjs`

**Step 1: Write the failing test** (`StreamProfile.test.mjs`)
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamProfile } from './StreamProfile.mjs';
import { STREAM_FORMATS } from './StreamFormat.mjs';

test('matches by host (case-insensitive, with/without www)', () => {
  const p = new StreamProfile({ name: 'soccerfull', match: { hosts: ['soccerfull.net'] }, strategy: 'scrape', format: 'hls_video' });
  assert.equal(p.matches('https://www.soccerfull.net/play/14360'), true);
  assert.equal(p.matches('https://SOCCERFULL.NET/x'), true);
  assert.equal(p.matches('https://example.com/x'), false);
});

test('matches by url regex when provided', () => {
  const p = new StreamProfile({ name: 'x', match: { urlRegex: '/match/\\d+' }, strategy: 'iframe', format: 'webview' });
  assert.equal(p.matches('https://x.tv/match/99'), true);
  assert.equal(p.matches('https://x.tv/other'), false);
});

test('rejects unknown strategy/format', () => {
  assert.throws(() => new StreamProfile({ name: 'x', strategy: 'bogus', format: 'video' }));
  assert.throws(() => new StreamProfile({ name: 'x', strategy: 'scrape', format: 'bogus' }));
});

test('STREAM_FORMATS are the three published formats', () => {
  assert.deepEqual([...STREAM_FORMATS].sort(), ['hls_video', 'video', 'webview']);
});
```

**Step 2: Run, expect fail**
Run: `node --test backend/src/2_domains/content/value-objects/StreamProfile.test.mjs`
Expected: FAIL (module not found).

**Step 3: Implement**

`StreamFormat.mjs`:
```javascript
// Published-language playback formats a stream can resolve to. No vendor words.
export const STREAM_FORMATS = new Set(['video', 'hls_video', 'webview']);
export const STREAM_STRATEGIES = new Set(['scrape', 'ytdlp', 'iframe']);
```

`StreamResult.mjs`:
```javascript
import { ValidationError } from '../../core/errors/index.mjs';
import { STREAM_FORMATS } from './StreamFormat.mjs';

/**
 * Normalized output of any IStreamResolver. Immutable.
 * @property {('video'|'hls_video'|'webview')} format
 * @property {string} mediaUrl  - direct, proxied, or (for webview) the page URL
 * @property {string} [title]
 * @property {string} [poster]
 * @property {number} [duration]
 * @property {Object} [headers]  - upstream headers the CDN needs (passed to the proxy)
 */
export class StreamResult {
  constructor({ format, mediaUrl, title = null, poster = null, duration = null, headers = null }) {
    if (!STREAM_FORMATS.has(format)) throw new ValidationError(`Invalid stream format: ${format}`, { field: 'format' });
    if (!mediaUrl || typeof mediaUrl !== 'string') throw new ValidationError('StreamResult requires mediaUrl', { field: 'mediaUrl' });
    this.format = format;
    this.mediaUrl = mediaUrl;
    this.title = title;
    this.poster = poster;
    this.duration = duration;
    this.headers = headers;
    Object.freeze(this);
  }
}
```

`StreamProfile.mjs`:
```javascript
import { ValidationError } from '../../core/errors/index.mjs';
import { STREAM_FORMATS, STREAM_STRATEGIES } from './StreamFormat.mjs';

/**
 * A site profile loaded from data/system/config/streaming/<name>.yml.
 * Holds only data + a pure matches() predicate. No site logic.
 */
export class StreamProfile {
  constructor(raw = {}) {
    const { name, match = {}, strategy, format } = raw;
    if (!name) throw new ValidationError('StreamProfile requires name', { field: 'name' });
    if (!STREAM_STRATEGIES.has(strategy)) throw new ValidationError(`Invalid strategy: ${strategy}`, { field: 'strategy' });
    if (!STREAM_FORMATS.has(format)) throw new ValidationError(`Invalid format: ${format}`, { field: 'format' });
    this.name = name;
    this.strategy = strategy;
    this.format = format;
    this.hosts = (match.hosts || []).map((h) => String(h).toLowerCase().replace(/^www\./, ''));
    this.urlRegex = match.urlRegex ? new RegExp(match.urlRegex) : null;
    this.raw = raw; // strategy-specific blocks (scrape.patterns, headers, ytdlp.args, ...)
    Object.freeze(this);
  }

  matches(url) {
    try {
      if (this.urlRegex && this.urlRegex.test(url)) return true;
      if (this.hosts.length) {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return this.hosts.includes(host);
      }
    } catch { /* invalid URL → no match */ }
    return false;
  }
}
```

**Step 4: Run, expect pass**
Run: `node --test backend/src/2_domains/content/value-objects/StreamProfile.test.mjs`
Expected: PASS.

> If `../../core/errors/index.mjs` is the wrong relative depth, verify against an existing value object (e.g. `ItemId.mjs`) and match its import.

**Step 5: Commit**
```bash
git add backend/src/2_domains/content/value-objects/Stream*.mjs
git commit -m "feat(content): stream format/result/profile value objects"
```

---

## Task 2: Application port — IStreamResolver

**Files:**
- Create: `backend/src/3_applications/content/ports/IStreamResolver.mjs`
- Modify: `backend/src/3_applications/content/ports/index.mjs` (export it)

**Step 1: Implement** (interfaces have no behavior to TDD; keep minimal)
```javascript
// What StreamAdapter needs from any resolution strategy. Vendor-neutral.
/**
 * @typedef {import('../../../2_domains/content/value-objects/StreamResult.mjs').StreamResult} StreamResult
 * @interface IStreamResolver
 */
export class IStreamResolver {
  /** @returns {string} strategy key matching StreamProfile.strategy ('scrape'|'ytdlp'|'iframe') */
  get strategy() { throw new Error('IStreamResolver.strategy must be implemented'); }

  /**
   * @param {string} url
   * @param {import('../../../2_domains/content/value-objects/StreamProfile.mjs').StreamProfile} [profile]
   * @returns {Promise<StreamResult|null>} null = declined
   */
  async resolve(url, profile) { throw new Error('IStreamResolver.resolve must be implemented'); }
}

export function isStreamResolver(o) {
  return o && typeof o.resolve === 'function' && typeof o.strategy === 'string';
}
```

**Step 2:** Add `export * from './IStreamResolver.mjs';` (match the style of the existing `index.mjs`).

**Step 3: Commit**
```bash
git add backend/src/3_applications/content/ports/
git commit -m "feat(content): IStreamResolver port"
```

---

## Task 3: System — load streaming profiles in ConfigService

**Files:**
- Modify: `backend/src/0_system/config/ConfigService.mjs` (add `getStreamingProfiles()`)
- Test: `backend/src/0_system/config/ConfigService.streaming.test.mjs`

Background: `getConfigDir()` returns the system config dir (`backend/src/0_system/config/ConfigService.mjs:289`). Profiles live in `<configDir>/streaming/*.yml`. Read & parse them lazily, cached.

**Step 1: Write failing test**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigService } from './ConfigService.mjs';

test('getStreamingProfiles globs streaming/*.yml as raw objects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.mkdirSync(path.join(dir, 'streaming'));
  fs.writeFileSync(path.join(dir, 'streaming', 'soccerfull.yml'),
    'name: soccerfull\nstrategy: scrape\nformat: hls_video\nmatch:\n  hosts: [soccerfull.net]\n');
  const svc = new ConfigService({ system: { configDir: dir } });
  const profiles = svc.getStreamingProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, 'soccerfull');
  assert.equal(profiles[0].strategy, 'scrape');
});

test('getStreamingProfiles returns [] when dir absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const svc = new ConfigService({ system: { configDir: dir } });
  assert.deepEqual(svc.getStreamingProfiles(), []);
});
```

**Step 2: Run, expect fail**
Run: `node --test backend/src/0_system/config/ConfigService.streaming.test.mjs`

**Step 3: Implement** — add near the other system-config getters (after `getSystemConfig`). Use the repo's existing YAML lib (check the file's imports; the codebase uses `yaml` / `js-yaml` elsewhere — match whatever `ConfigService` or a sibling already imports).
```javascript
  /**
   * Load raw streaming site profiles from <configDir>/streaming/*.yml.
   * Returns plain objects (NOT StreamProfile instances — keep 0_system vendor/domain-free).
   * @returns {Array<Object>}
   */
  getStreamingProfiles() {
    if (this.#streamingProfilesCache) return this.#streamingProfilesCache;
    const dir = path.join(this.getConfigDir(), 'streaming');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')); }
    catch { this.#streamingProfilesCache = []; return this.#streamingProfilesCache; }
    const profiles = [];
    for (const f of files) {
      try {
        const parsed = YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (parsed && typeof parsed === 'object') profiles.push(parsed);
      } catch { /* skip malformed profile */ }
    }
    this.#streamingProfilesCache = profiles;
    return profiles;
  }
```
Add `#streamingProfilesCache = null;` to the class fields, and ensure `fs`, `path`, and the YAML parser are imported at the top (reuse existing imports if present).

**Step 4: Run, expect pass**
Run: `node --test backend/src/0_system/config/ConfigService.streaming.test.mjs`

**Step 5: Commit**
```bash
git add backend/src/0_system/config/ConfigService*.mjs
git commit -m "feat(config): getStreamingProfiles globs streaming/*.yml"
```

---

## Task 4a: IframeStreamResolver (terminal, no deps)

**Files:**
- Create: `backend/src/1_adapters/content/stream/resolvers/IframeStreamResolver.mjs`
- Test: `backend/src/1_adapters/content/stream/resolvers/IframeStreamResolver.test.mjs`

**Step 1: Failing test**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IframeStreamResolver } from './IframeStreamResolver.mjs';

test('always resolves any http(s) url to a webview result', async () => {
  const r = new IframeStreamResolver();
  const out = await r.resolve('https://soccerfull.net/play/14360');
  assert.equal(out.format, 'webview');
  assert.equal(out.mediaUrl, 'https://soccerfull.net/play/14360');
});

test('declines non-http', async () => {
  const r = new IframeStreamResolver();
  assert.equal(await r.resolve('ftp://x/y'), null);
});
```

**Step 2:** Run, expect fail.

**Step 3: Implement**
```javascript
import { IStreamResolver } from '#apps/content/ports/IStreamResolver.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';

/** Terminal resolver: renders any web page in an iframe. */
export class IframeStreamResolver extends IStreamResolver {
  get strategy() { return 'iframe'; }
  async resolve(url, profile) {
    if (!/^https?:\/\//i.test(url)) return null;
    return new StreamResult({ format: 'webview', mediaUrl: url, title: profile?.name ?? null });
  }
}
```

**Step 4:** Run, expect pass.

**Step 5: Commit**
```bash
git add backend/src/1_adapters/content/stream/resolvers/IframeStreamResolver*
git commit -m "feat(stream): iframe terminal resolver"
```

---

## Task 4b: ScrapeStreamResolver (HTTP fetch + config regex)

**Files:**
- Create: `backend/src/1_adapters/content/stream/resolvers/ScrapeStreamResolver.mjs`
- Test: `backend/src/1_adapters/content/stream/resolvers/ScrapeStreamResolver.test.mjs`

It fetches the page HTML (injecting `profile.raw.scrape.headers`), runs `profile.raw.scrape.patterns` (first capture group that hits wins), and returns a `StreamResult` with `format: profile.format`. It does NOT itself proxy — it hands back the discovered absolute URL plus `headers`; the StreamAdapter decides whether to wrap it in the proxy (Task 5). Inject `fetch` for testability.

**Step 1: Failing test**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrapeStreamResolver } from './ScrapeStreamResolver.mjs';
import { StreamProfile } from '#domains/content/value-objects/StreamProfile.mjs';

const profile = new StreamProfile({
  name: 'soccerfull', strategy: 'scrape', format: 'hls_video',
  match: { hosts: ['soccerfull.net'] },
  scrape: { patterns: ['file:\\s*"([^"]+\\.m3u8[^"]*)"'], headers: { referer: 'https://soccerfull.net/' } },
});

test('extracts m3u8 via configured pattern', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'var x = { file: "https://cdn.x/h.m3u8?t=1" };' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  const out = await r.resolve('https://soccerfull.net/play/14360', profile);
  assert.equal(out.format, 'hls_video');
  assert.equal(out.mediaUrl, 'https://cdn.x/h.m3u8?t=1');
  assert.deepEqual(out.headers, { referer: 'https://soccerfull.net/' });
});

test('declines when no pattern matches', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => '<html>nope</html>' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  assert.equal(await r.resolve('https://soccerfull.net/play/14360', profile), null);
});

test('resolves relative stream URL against the page url', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'file: "/hls/h.m3u8"' });
  const r = new ScrapeStreamResolver({ fetchFn: fakeFetch });
  const out = await r.resolve('https://soccerfull.net/play/14360', profile);
  assert.equal(out.mediaUrl, 'https://soccerfull.net/hls/h.m3u8');
});
```

**Step 2:** Run, expect fail.

**Step 3: Implement**
```javascript
import { IStreamResolver } from '#apps/content/ports/IStreamResolver.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';

export class ScrapeStreamResolver extends IStreamResolver {
  #fetch; #logger;
  constructor({ fetchFn = fetch, logger = console } = {}) {
    super();
    this.#fetch = fetchFn;
    this.#logger = logger;
  }
  get strategy() { return 'scrape'; }

  async resolve(url, profile) {
    const cfg = profile?.raw?.scrape || {};
    const headers = cfg.headers || {};
    let html;
    try {
      const res = await this.#fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', ...headers } });
      if (!res.ok) return null;
      html = await res.text();
    } catch (e) {
      this.#logger.warn?.('stream.scrape.fetch_failed', { url, error: e.message });
      return null;
    }
    for (const pat of cfg.patterns || []) {
      const m = html.match(new RegExp(pat, 'i'));
      if (m && m[1]) {
        const mediaUrl = new URL(m[1], url).toString(); // resolve relative
        return new StreamResult({ format: profile.format, mediaUrl, headers: cfg.headers || null });
      }
    }
    return null;
  }
}
```

**Step 4:** Run, expect pass.

**Step 5: Commit**
```bash
git add backend/src/1_adapters/content/stream/resolvers/ScrapeStreamResolver*
git commit -m "feat(stream): config-driven scrape resolver"
```

---

## Task 4c: YtDlpStreamResolver (wraps existing YtDlpAdapter)

**Files:**
- Create: `backend/src/1_adapters/content/stream/resolvers/YtDlpStreamResolver.mjs`
- Test: `backend/src/1_adapters/content/stream/resolvers/YtDlpStreamResolver.test.mjs`
- Possibly Modify: `backend/src/1_adapters/media/YtDlpAdapter.mjs` (add a `probe(url)` method that runs `yt-dlp -J <url>` without downloading, if no equivalent exists — inspect the file first).

This resolver runs `yt-dlp -J` (JSON dump, no download) to get the best playable URL + title. Map the chosen format's protocol to our `format`: an `m3u8*` protocol or `.m3u8` URL → `hls_video`; otherwise `video`. Inject the probe fn for testability.

**Step 1: Failing test** (inject a fake probe so no real yt-dlp runs)
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YtDlpStreamResolver } from './YtDlpStreamResolver.mjs';

test('maps hls protocol to hls_video', async () => {
  const probe = async () => ({ title: 'T', url: 'https://cdn/x.m3u8', protocol: 'm3u8_native' });
  const r = new YtDlpStreamResolver({ probe });
  const out = await r.resolve('https://youtu.be/abc');
  assert.equal(out.format, 'hls_video');
  assert.equal(out.mediaUrl, 'https://cdn/x.m3u8');
  assert.equal(out.title, 'T');
});

test('maps progressive mp4 to video', async () => {
  const probe = async () => ({ title: 'T', url: 'https://cdn/x.mp4', protocol: 'https' });
  const r = new YtDlpStreamResolver({ probe });
  assert.equal((await r.resolve('https://vimeo.com/1')).format, 'video');
});

test('declines when probe throws / no url', async () => {
  const r = new YtDlpStreamResolver({ probe: async () => { throw new Error('unsupported'); } });
  assert.equal(await r.resolve('https://unknown.tld/x'), null);
});
```

**Step 2:** Run, expect fail.

**Step 3: Implement** (default `probe` delegates to `YtDlpAdapter`; vendor name stays in adapter layer)
```javascript
import { IStreamResolver } from '#apps/content/ports/IStreamResolver.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';

export class YtDlpStreamResolver extends IStreamResolver {
  #probe; #logger;
  constructor({ probe, ytDlpAdapter, logger = console } = {}) {
    super();
    this.#logger = logger;
    this.#probe = probe || (async (url) => ytDlpAdapter.probe(url)); // probe runs `yt-dlp -J`
  }
  get strategy() { return 'ytdlp'; }

  async resolve(url, profile) {
    let info;
    try { info = await this.#probe(url, profile?.raw?.ytdlp); }
    catch (e) { this.#logger.warn?.('stream.ytdlp.probe_failed', { url, error: e.message }); return null; }
    if (!info?.url) return null;
    const isHls = /m3u8/i.test(info.protocol || '') || /\.m3u8(\?|$)/i.test(info.url);
    return new StreamResult({
      format: isHls ? 'hls_video' : 'video',
      mediaUrl: info.url,
      title: info.title ?? null,
      duration: info.duration ?? null,
      poster: info.thumbnail ?? null,
    });
  }
}
```

**Step 3b:** If `YtDlpAdapter` lacks a `probe(url)`, add one that shells `yt-dlp -J --no-warnings <url>`, parses stdout JSON, and returns `{ title, duration, thumbnail, url, protocol }` from the best progressive/combined format (reuse the existing exec/timeout helpers in that file). Add a colocated unit test for the JSON-mapping logic only (no network).

**Step 4:** Run, expect pass.

**Step 5: Commit**
```bash
git add backend/src/1_adapters/content/stream/resolvers/YtDlpStreamResolver* backend/src/1_adapters/media/YtDlpAdapter.mjs
git commit -m "feat(stream): yt-dlp resolver (probe-only, no download)"
```

---

## Task 5: StreamAdapter (IContentSource) + base64url codec

**Files:**
- Create: `backend/src/1_adapters/content/stream/streamUrlCodec.mjs`
- Create: `backend/src/1_adapters/content/stream/StreamAdapter.mjs`
- Create: `backend/src/1_adapters/content/stream/manifest.mjs`
- Test: `backend/src/1_adapters/content/stream/StreamAdapter.test.mjs`
- Test: `backend/src/1_adapters/content/stream/streamUrlCodec.test.mjs`

`StreamAdapter` matches a profile (or falls back to an implicit ytdlp attempt), dispatches to the right resolver by `strategy`, and converts the `StreamResult` → a content `Item` whose `metadata.contentFormat` and `mediaUrl` drive the rest of the pipeline. For non-`webview` results whose `mediaUrl` is a third-party absolute URL, it wraps the URL in the stream proxy (Task 7) so headers/CORS are handled — passing `profile` name so the proxy can re-load headers server-side.

**Step 1a: codec test**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeStreamUrl, decodeStreamUrl } from './streamUrlCodec.mjs';

test('round-trips a url with slashes/colons/query', () => {
  const url = 'https://soccerfull.net/play/14360?a=b';
  const tok = encodeStreamUrl(url);
  assert.ok(!/[:/]/.test(tok)); // path-safe: no colon or slash
  assert.equal(decodeStreamUrl(tok), url);
});

test('decode passes through a raw http url unchanged', () => {
  assert.equal(decodeStreamUrl('https://x/y'), 'https://x/y');
});
```

**Step 1b: adapter test**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamAdapter } from './StreamAdapter.mjs';
import { StreamProfile } from '#domains/content/value-objects/StreamProfile.mjs';
import { StreamResult } from '#domains/content/value-objects/StreamResult.mjs';
import { encodeStreamUrl } from './streamUrlCodec.mjs';

function fakeResolver(strategy, result) {
  return { strategy, resolve: async () => result };
}

test('source + prefixes', () => {
  const a = new StreamAdapter({ resolvers: [], profiles: [] });
  assert.equal(a.source, 'stream');
  assert.deepEqual(a.prefixes, [{ prefix: 'stream' }]);
});

test('webview result -> item with contentFormat webview, page url as mediaUrl', async () => {
  const a = new StreamAdapter({
    profiles: [],
    resolvers: [fakeResolver('iframe', new StreamResult({ format: 'webview', mediaUrl: 'https://x/y' }))],
    fallbackStrategy: 'iframe',
  });
  const item = await a.getItem(encodeStreamUrl('https://x/y'));
  assert.equal(item.metadata.contentFormat, 'webview');
  assert.equal(item.mediaUrl, 'https://x/y');
});

test('hls result -> contentFormat hls_video, mediaUrl wrapped in stream proxy', async () => {
  const profile = new StreamProfile({ name: 'soccerfull', strategy: 'scrape', format: 'hls_video', match: { hosts: ['soccerfull.net'] } });
  const a = new StreamAdapter({
    profiles: [profile],
    resolvers: [fakeResolver('scrape', new StreamResult({ format: 'hls_video', mediaUrl: 'https://cdn/h.m3u8' }))],
    fallbackStrategy: 'iframe',
  });
  const item = await a.getItem(encodeStreamUrl('https://soccerfull.net/play/14360'));
  assert.equal(item.metadata.contentFormat, 'hls_video');
  assert.equal(item.mediaType, 'hls_video');
  assert.match(item.mediaUrl, /^\/api\/v1\/proxy\/stream\?/);
  assert.match(item.mediaUrl, /profile=soccerfull/);
});

test('resolvePlayables returns single-item array', async () => {
  const a = new StreamAdapter({ profiles: [], resolvers: [fakeResolver('iframe', new StreamResult({ format: 'webview', mediaUrl: 'https://x/y' }))], fallbackStrategy: 'iframe' });
  const items = await a.resolvePlayables(encodeStreamUrl('https://x/y'));
  assert.equal(items.length, 1);
});
```

**Step 2:** Run both test files, expect fail.

**Step 3: Implement**

`streamUrlCodec.mjs`:
```javascript
// base64url so a URL survives Express path routing inside `stream:<token>`.
export function encodeStreamUrl(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}
export function decodeStreamUrl(token) {
  if (/^https?:\/\//i.test(token)) return token; // already a raw url (defensive)
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    return /^https?:\/\//i.test(decoded) ? decoded : token;
  } catch { return token; }
}
```

`manifest.mjs`:
```javascript
export default { capability: 'stream', provider: 'stream' };
```

`StreamAdapter.mjs`:
```javascript
import { Item } from '#domains/content/entities/Item.mjs';
import { decodeStreamUrl } from './streamUrlCodec.mjs';

const STREAM_PROXY_PATH = '/api/v1/proxy/stream';

/**
 * Vendor-blind content source for arbitrary online URLs.
 * Holds an ordered IStreamResolver[] keyed by strategy and a StreamProfile[].
 */
export class StreamAdapter {
  #resolvers; #profiles; #fallbackStrategy; #logger;
  constructor({ resolvers = [], profiles = [], fallbackStrategy = 'ytdlp', logger = console } = {}) {
    this.#resolvers = new Map(resolvers.map((r) => [r.strategy, r]));
    this.#profiles = profiles;
    this.#fallbackStrategy = fallbackStrategy;
    this.#logger = logger;
  }

  get source() { return 'stream'; }
  get prefixes() { return [{ prefix: 'stream' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const token = String(id).replace(/^stream:/, '');
    const url = decodeStreamUrl(token);
    const profile = this.#profiles.find((p) => p.matches(url)) || null;
    const strategy = profile?.strategy || this.#fallbackStrategy;

    let result = await this.#tryStrategy(strategy, url, profile);
    if (!result && strategy !== 'iframe') result = await this.#tryStrategy('iframe', url, profile); // terminal fallback
    if (!result) return null;

    const mediaUrl = result.format === 'webview'
      ? result.mediaUrl
      : this.#proxify(result.mediaUrl, profile?.name);

    return new Item({
      id: `stream:${token}`,
      title: result.title || profile?.name || url,
      thumbnail: result.poster || null,
      metadata: { contentFormat: result.format, sourceUrl: url },
      // top-level fields read by PlayResponseService.toPlayResponse:
      ...{ mediaUrl, mediaType: result.format, duration: result.duration },
    });
  }

  async #tryStrategy(strategy, url, profile) {
    const resolver = this.#resolvers.get(strategy);
    if (!resolver) return null;
    try { return await resolver.resolve(url, profile); }
    catch (e) { this.#logger.warn?.('stream.resolver.threw', { strategy, url, error: e.message }); return null; }
  }

  #proxify(mediaUrl, profileName) {
    const q = new URLSearchParams({ src: mediaUrl });
    if (profileName) q.set('profile', profileName);
    return `${STREAM_PROXY_PATH}?${q.toString()}`;
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  async getList() { return []; }
  async resolveSiblings() { return null; }
}
```

> Note: `Item` requires `title` and accepts arbitrary props; `PlayResponseService.toPlayResponse` reads `item.mediaUrl`, `item.mediaType`, `item.duration`, and `resolveFormat` reads `item.metadata.contentFormat`. Confirm `Item` passes through `mediaUrl`/`mediaType`/`duration` — if the constructor whitelists props, set them as own properties after construction (the test will catch this).

**Step 4:** Run both, expect pass. Fix `Item` field passthrough if needed.

**Step 5: Commit**
```bash
git add backend/src/1_adapters/content/stream/
git commit -m "feat(stream): StreamAdapter + base64url codec"
```

---

## Task 6: Wire StreamAdapter into bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (imports near top ~line 32; registration near the FreshVideo block ~line 617-627)

**Step 1:** Add imports (top, with the other `#adapters/content/...` imports):
```javascript
import { StreamAdapter } from '#adapters/content/stream/StreamAdapter.mjs';
import streamManifest from '#adapters/content/stream/manifest.mjs';
import { IframeStreamResolver } from '#adapters/content/stream/resolvers/IframeStreamResolver.mjs';
import { ScrapeStreamResolver } from '#adapters/content/stream/resolvers/ScrapeStreamResolver.mjs';
import { YtDlpStreamResolver } from '#adapters/content/stream/resolvers/YtDlpStreamResolver.mjs';
import { StreamProfile } from '#domains/content/value-objects/StreamProfile.mjs';
```

**Step 2:** Register near the FreshVideo block. The `ytDlpAdapter` should already be constructed earlier in bootstrap (search for `YtDlpAdapter` / `ytdlp`); reuse that instance. If none exists in this scope, construct one.
```javascript
  // Register StreamAdapter for `stream:` prefix — arbitrary online URLs.
  {
    const rawProfiles = configService.getStreamingProfiles?.() || [];
    const profiles = [];
    for (const raw of rawProfiles) {
      try { profiles.push(new StreamProfile(raw)); }
      catch (e) { logger.warn?.('stream.profile.invalid', { name: raw?.name, error: e.message }); }
    }
    const resolvers = [
      new ScrapeStreamResolver({ logger }),
      new YtDlpStreamResolver({ ytDlpAdapter, logger }),
      new IframeStreamResolver(),
    ];
    registry.register(
      new StreamAdapter({ resolvers, profiles, fallbackStrategy: 'ytdlp', logger }),
      { category: streamManifest.capability, provider: streamManifest.provider }
    );
  }
```
Match the exact local variable names in scope (`configService` vs `config`, `logger`, `registry`, `ytDlpAdapter`) — read the surrounding code first.

**Step 3: Smoke**
Run the backend and hit the play API directly with an iframe-only token (no network needed):
```bash
node -e "import('./backend/src/1_adapters/content/stream/streamUrlCodec.mjs').then(m=>console.log('stream:'+m.encodeStreamUrl('https://example.com/x')))"
```
Start dev backend (per CLAUDE.md; check the port first) and:
```bash
curl -s "http://localhost:3112/api/v1/play/stream:<TOKEN>" | jq '{format,mediaUrl}'
```
Expected: `{ "format": "webview", "mediaUrl": "https://example.com/x" }` (example.com isn't a known scrape/ytdlp site → falls to iframe).

**Step 4: Commit**
```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(stream): register StreamAdapter (stream: prefix)"
```

---

## Task 7: Backend stream proxy (`/api/v1/proxy/stream`)

> **Why proxy at all, and why NOT `backend/src/0_system/proxy/ProxyService`:** `hls_video` requires a proxy because hls.js fetches the `.m3u8` + every `.ts` segment via CORS-gated `fetch`/XHR, and third-party CDNs don't send `Access-Control-Allow-Origin`; proxying makes them same-origin. Remote `video` (mp4) usually needs it too, because CDNs enforce `Referer`/`User-Agent` hotlink checks the browser can't satisfy cross-origin. **`webview` is never proxied** (the iframe navigates the page itself; CORS doesn't apply). The existing `ProxyService`/`IProxyAdapter` is the WRONG vehicle: it resolves the target as `new URL(path, adapter.getBaseUrl())` — a **fixed base host per registered service** — and only pipes bytes. Our proxy needs a **dynamic per-request origin** (the CDN varies per stream) and **m3u8 playlist rewriting**, neither of which fits that contract. So implement a dedicated route in `proxy.mjs` (same file/layer as the existing Plex/media proxy routes).

**Files:**
- Modify: `backend/src/4_api/v1/routers/proxy.mjs` (add route)
- Test: `backend/src/4_api/v1/routers/proxy.stream.test.mjs` (unit-test the m3u8 rewrite helper)

Behavior of `GET /api/v1/proxy/stream?src=<absUrl>&profile=<name>`:
1. Load `profile` (via injected ConfigService → StreamProfile) to get `scrape.headers` (referer/UA).
2. Fetch `src` with those headers.
3. If content-type is an HLS playlist (`application/vnd.apple.mpegurl`/`audio/mpegurl`) or `src` ends `.m3u8`: read body, **rewrite** every non-comment URI line and `URI="..."` attribute to `/api/v1/proxy/stream?src=<abs(child)>&profile=<name>`, serve as `application/vnd.apple.mpegurl`.
4. Else: stream bytes through with range support + pass content-type (segments, mp4).

Keep the rewrite logic in a pure exported helper so it is unit-testable without network.

**Step 1: Failing test** (helper only)
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHlsPlaylist } from './proxy.mjs';

test('rewrites relative + absolute segment/variant URIs through the proxy', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1',
    'sub/variant.m3u8',
    '#EXTINF:6,',
    'https://cdn.x/seg1.ts',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.x/key"',
  ].join('\n');
  const out = rewriteHlsPlaylist(playlist, 'https://cdn.x/live/index.m3u8', 'soccerfull');
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Flive%2Fsub%2Fvariant\.m3u8&profile=soccerfull/);
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fseg1\.ts&profile=soccerfull/);
  assert.match(out, /URI="\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fkey&profile=soccerfull"/);
  assert.match(out, /#EXTINF:6,/); // comments untouched
});
```

**Step 2:** Run, expect fail.

**Step 3: Implement** the exported helper + route. Helper:
```javascript
export function rewriteHlsPlaylist(text, baseUrl, profile) {
  const wrap = (u) => {
    const abs = new URL(u, baseUrl).toString();
    const q = new URLSearchParams({ src: abs });
    if (profile) q.set('profile', profile);
    return `/api/v1/proxy/stream?${q.toString()}`;
  };
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      // rewrite URI="..." inside tags (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP)
      return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
    }
    return wrap(t); // a URI line (variant or segment)
  }).join('\n');
}
```
Route (follow the patterns/imports already in `proxy.mjs`; inject `configService`/`getStreamingProfiles` to read headers). Use `fetch` and pipe with range passthrough like the existing media routes. On HLS content-type → `res.type('application/vnd.apple.mpegurl').send(rewriteHlsPlaylist(body, src, profile))`.

**Step 4:** Run, expect pass.

**Step 5: Commit**
```bash
git add backend/src/4_api/v1/routers/proxy.mjs backend/src/4_api/v1/routers/proxy.stream.test.mjs
git commit -m "feat(proxy): stream proxy with header injection + m3u8 rewrite"
```

---

## Task 8a: Frontend — normalize stream contentIds to a path-safe token

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js` (in `fetchMediaInfo`, before building the URL)
- Test: `frontend/src/modules/Player/lib/api.streamId.test.js` (vitest)

The raw `stream:https://...` must become `stream:<base64url>` before being placed in the `/play/...` path.

**Step 1: Failing test**
```javascript
import { describe, it, expect } from 'vitest';
import { normalizeStreamContentId } from './api.js';

describe('normalizeStreamContentId', () => {
  it('base64url-encodes the url part of a raw stream id', () => {
    const out = normalizeStreamContentId('stream:https://soccerfull.net/play/14360');
    expect(out.startsWith('stream:')).toBe(true);
    expect(out).not.toMatch(/[/:]/.source.replace('/','') ); // token part has no slash/colon
    const tok = out.slice('stream:'.length);
    expect(atob(tok.replace(/-/g,'+').replace(/_/g,'/'))).toBe('https://soccerfull.net/play/14360');
  });
  it('leaves already-encoded stream ids and non-stream ids unchanged', () => {
    expect(normalizeStreamContentId('plex:123')).toBe('plex:123');
    const enc = normalizeStreamContentId('stream:https://x/y');
    expect(normalizeStreamContentId(enc)).toBe(enc);
  });
});
```

**Step 2:** Run, expect fail: `npx vitest run frontend/src/modules/Player/lib/api.streamId.test.js`

**Step 3: Implement** — add to `api.js` and call it on `effectiveContentId` before `buildUrl(...)`:
```javascript
// A stream: id may arrive as `stream:<raw url>` (from device load). The url's
// slashes/colons break Express path routing, so encode it base64url here.
export function normalizeStreamContentId(contentId) {
  if (typeof contentId !== 'string' || !contentId.startsWith('stream:')) return contentId;
  const rest = contentId.slice('stream:'.length);
  if (!/^https?:\/\//i.test(rest)) return contentId; // already a token
  const b64 = btoa(unescape(encodeURIComponent(rest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `stream:${b64}`;
}
```
Then in `fetchMediaInfo`: `const effectiveContentId = normalizeStreamContentId(contentId || ...);`

**Step 4:** Run, expect pass.

**Step 5: Commit**
```bash
git add frontend/src/modules/Player/lib/api.js frontend/src/modules/Player/lib/api.streamId.test.js
git commit -m "feat(player): normalize stream: contentIds to path-safe token"
```

---

## Task 8b: Frontend — hls.js dependency + VideoPlayer HLS branch

**Files:**
- Modify: `frontend/package.json` (add `"hls.js"` — same version as root, `^1.6.16`)
- Modify: `frontend/src/modules/Player/lib/registry.js` (add `hls_video` to `MEDIA_PLAYBACK_FORMATS`)
- Modify: `frontend/src/modules/Player/components/SinglePlayer.jsx` (media branch: `hls_video` → `VideoPlayer`)
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (attach hls.js when HLS)

**Step 1:** `cd frontend && npm install hls.js@^1.6.16`

**Step 2:** In `registry.js`: `const MEDIA_PLAYBACK_FORMATS = new Set(['video', 'dash_video', 'audio', 'image', 'hls_video']);`

**Step 3:** In `SinglePlayer.jsx` `renderByFormat()`, the media branch currently does `const PlayerComponent = format === 'audio' ? AudioPlayer : VideoPlayer;` — that already routes `hls_video` to `VideoPlayer`. Verify `isMediaFormat('hls_video')` is true now. No change beyond confirming.

**Step 4:** In `VideoPlayer.jsx`: it currently branches `isDash` (`media.mediaType === 'dash_video'`) → `<dash-video>` else native `<video>`. Add HLS support on the native path. Detect `const isHls = media.mediaType === 'hls_video';`. When `isHls` and the browser can't natively play HLS, attach hls.js to the `<video>` element via an effect:
```javascript
import Hls from 'hls.js';
// ...
useEffect(() => {
  if (!isHls) return;
  const video = containerRef.current;
  if (!video) return;
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = mediaUrl; return; }
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(mediaUrl);
    hls.attachMedia(video);
    return () => hls.destroy();
  }
}, [isHls, mediaUrl]);
```
For the HLS case, render the native `<video>` WITHOUT a `src` attribute (hls.js sets it). Keep `isDash` path untouched. Add structured logs (`logger.info('video.hls.attached', {...})`, error path) per CLAUDE.md logging rules.

**Step 5:** Run existing VideoPlayer/Player tests if any: `npx vitest run frontend/src/modules/Player`. Expected: PASS (no regressions).

**Step 6: Commit**
```bash
git add frontend/package.json frontend/package-lock.json frontend/src/modules/Player/
git commit -m "feat(player): hls_video playback via hls.js"
```

---

## Task 8c: Frontend — WebViewRenderer (iframe) + registry

**Files:**
- Create: `frontend/src/modules/Player/renderers/WebViewRenderer.jsx`
- Modify: `frontend/src/modules/Player/lib/registry.js` (register `webview`)
- Test: `frontend/src/modules/Player/renderers/WebViewRenderer.test.jsx`

`webview` is a CONTENT format (not media): `SinglePlayer` will call `getRenderer('webview')`. The renderer fills the screen with an `<iframe src={initialData.mediaUrl}>` and wires the Playable Contract (clear/advance + keyboard) — model it on `ImageFrame.jsx` (`frontend/src/modules/Player/renderers/ImageFrame.jsx`).

**Step 1: Failing test**
```javascript
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import WebViewRenderer from './WebViewRenderer.jsx';

describe('WebViewRenderer', () => {
  it('renders an iframe pointing at mediaUrl', () => {
    const { container } = render(<WebViewRenderer initialData={{ mediaUrl: 'https://soccerfull.net/play/14360', title: 'x' }} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toBe('https://soccerfull.net/play/14360');
  });
});
```

**Step 2:** Run, expect fail.

**Step 3: Implement**
```jsx
import { useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';

export default function WebViewRenderer({ initialData = {}, clear }) {
  const url = initialData.mediaUrl;
  const logger = useMemo(() => getLogger().child({ component: 'webview-renderer' }), []);
  useEffect(() => { logger.info('webview.mounted', { url }); return () => logger.info('webview.unmounted', { url }); }, [logger, url]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Backspace') clear?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear]);
  if (!url) return null;
  return (
    <div className="webview-renderer" style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <iframe
        title={initialData.title || 'stream'}
        src={url}
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
WebViewRenderer.propTypes = { initialData: PropTypes.object, clear: PropTypes.func };
```

**Step 4:** Register in `registry.js`:
```javascript
import WebViewRenderer from '../renderers/WebViewRenderer.jsx';
// ...
const CONTENT_FORMAT_COMPONENTS = { /* ...existing..., */ webview: WebViewRenderer };
```

**Step 5:** Run, expect pass: `npx vitest run frontend/src/modules/Player/renderers/WebViewRenderer.test.jsx`

**Step 6: Commit**
```bash
git add frontend/src/modules/Player/renderers/WebViewRenderer.jsx frontend/src/modules/Player/lib/registry.js frontend/src/modules/Player/renderers/WebViewRenderer.test.jsx
git commit -m "feat(player): webview (iframe) renderer for stream fallback"
```

---

## Task 9: Author the soccerfull profile

**Files:**
- Create: `data/system/config/streaming/soccerfull.yml`

> This file lives in the Dropbox data tree (`{configDir}/streaming/`). Per CLAUDE.md, when mount perms block a write from macOS, write it via `ssh {env.prod_host}`. It is data, not code — do NOT commit it to git unless the repo already tracks `data/system/config/*` (check `.gitignore`).

**Step 1:** Inspect the real page once to find the stream pattern (skill `firecrawl-scrape` or `curl`), then write:
```yaml
name: soccerfull
match:
  hosts: [soccerfull.net]
strategy: scrape
format: hls_video
scrape:
  patterns:
    - 'file:\s*"([^"]+\.m3u8[^"]*)"'
    - 'source\s+src="([^"]+\.m3u8[^"]*)"'
    - '"(https?:[^"]+\.m3u8[^"]*)"'
  headers:
    referer: https://soccerfull.net/
    user-agent: "Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0"
```
If the page embeds the player in a nested iframe, either add the iframe host as its own profile, or set `strategy: iframe`/`format: webview` as the interim working path.

**Step 2:** No commit (data file). Restart the backend so `getStreamingProfiles()` re-reads (config is cached at construction).

---

## Task 10: End-to-end verification

**Step 1:** Backend resolution (no device needed):
```bash
TOKEN=$(node -e "import('./backend/src/1_adapters/content/stream/streamUrlCodec.mjs').then(m=>process.stdout.write(m.encodeStreamUrl('https://soccerfull.net/play/14360')))")
curl -s "http://localhost:3112/api/v1/play/stream:$TOKEN" | jq '{format,mediaUrl,title}'
```
Expected: `format` is `hls_video` (scrape hit) or `webview` (fallback), with a non-null `mediaUrl` (proxied for hls/video).

**Step 2:** Proxy serves the playlist:
```bash
curl -s "http://localhost:3112/api/v1/proxy/stream?src=<enc upstream m3u8>&profile=soccerfull" | head -5
```
Expected: `#EXTM3U` with child URIs rewritten to `/api/v1/proxy/stream?...`.

**Step 3:** The literal goal URL against a real screen (per memory `reference_state_modality` / device docs — pick a test screen id):
```
https://daylightlocal.kckern.net/api/v1/device/<screenid>/load?play=stream:https://soccerfull.net/play/14360
```
Expected: screen renders the match (native/hls video) or the page in an iframe. Use the verify skill / a vision agent to confirm pixels (per feedback memory `feedback_dont_ask_check_yourself`) rather than asking KC to eyeball it.

**Step 4:** Update docs — add a short section to `docs/reference/core/` (or a new `docs/reference/content/stream-sources.md`) describing the `stream:` source, the profile schema, and how to add a site. Update `docs/docs-last-updated.txt` per CLAUDE.md.

**Step 5: Final commit**
```bash
git add docs/
git commit -m "docs(stream): document stream: source + profile schema"
```

---

## Definition of done

- All colocated `*.test.mjs` / `*.test.js` pass (`node --test` backend, `npx vitest run` frontend).
- `curl /api/v1/play/stream:<token>` returns a valid `format` + `mediaUrl`.
- The goal device-load URL renders content on a screen (verified visually).
- No vendor string (`yt-dlp`, `soccerfull`, host regexes) outside `1_adapters/` or `.yml`.
- YAGNI check: no per-site `.mjs` files were created — only YAML profiles + generic resolvers.
- Docs updated; design doc + code committed on `feat/stream-sources`.

## Risks / notes for the executor

- **Item field passthrough:** if `Item` whitelists constructor props and drops `mediaUrl`/`mediaType`/`duration`, set them as own props after `new Item(...)`. The StreamAdapter test guards this.
- **`ytDlpAdapter` availability in bootstrap scope:** confirm the instance/variable name; construct one if absent.
- **HLS CORS:** always go through the stream proxy for `hls_video`/`video`; never hand a third-party CDN URL straight to the `<video>`/hls.js (CORS + hotlink headers will fail in the Firefox kiosk).
- **soccerfull specifics may change:** the profile patterns are data — iterate them without code changes. If the site is purely DRM/iframe, `webview` is the honest fallback.
- **Autoplay in Firefox kiosk** (garage): see CLAUDE.local.md — `media.autoplay.default=0` may be needed for audible autoplay of the iframe/video.
