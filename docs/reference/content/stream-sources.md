# Stream Sources (`stream:` content source)

Plays arbitrary **online URLs** on a screen — e.g.

```
/api/v1/device/<screenid>/load?play=stream:https://soccerfull.net/play/14360
```

The `stream` source resolves a web page to a playable stream and renders it. It is **vendor-blind**: all site-specific knowledge lives in YAML profiles under `data/system/config/streaming/`, never in code.

## How it resolves

```
play=stream:<url>
  │  (frontend normalizes the raw url to a path-safe base64url token: stream:<token>)
  ▼  ContentSourceRegistry → StreamAdapter.resolvePlayables
  │   1. pick the StreamProfile whose match.hosts / match.urlRegex matches <url>
  │      (no profile → implicit `ytdlp` attempt, then `iframe`)
  │   2. run the resolver named by the profile's `strategy`
  │      ├─ scrape  → fetch page, apply regex patterns, find the stream URL
  │      ├─ ytdlp   → yt-dlp -J (no download), pick best format
  │      └─ iframe  → terminal fallback, returns the page URL as-is
  │   3. decide a format: video | hls_video | webview
  ▼  /api/v1/play returns { format, mediaUrl, ... }
  ▼  SinglePlayer dispatches on format:
      ├─ video      → native <video>           (mediaUrl = proxied direct file)
      ├─ hls_video  → <video> + hls.js (lazy)   (mediaUrl = proxied .m3u8)
      └─ webview    → WebViewRenderer (<iframe>) (mediaUrl = the page URL)
```

`video`/`hls_video` media always flow through the **stream proxy** (`/api/v1/proxy/stream`) so third-party CDNs work despite CORS and `Referer`/`User-Agent` hotlink checks; for HLS the proxy also rewrites each playlist URI to re-enter the proxy. `webview` is never proxied (the iframe navigates the page itself).

## Profile schema

One file per site: `data/system/config/streaming/<name>.yml`.

```yaml
name: soccerfull                 # profile id; also the `profile=` value used by the proxy
match:
  hosts: [soccerfull.net]        # host match (www. is stripped); OR:
  # urlRegex: '/match/\d+'       # alternative: match by URL regex
strategy: scrape                 # scrape | ytdlp | iframe
format: hls_video                # video | hls_video | webview
scrape:                          # only for strategy: scrape
  patterns:                      # first capture group that matches wins; relative URLs
    - 'm3u8Url\s*=\s*"([^"]+\.m3u8[^"]*)"'   # are resolved against the page URL
  headers:                       # injected on the page fetch AND on the proxy fetch
    referer: https://soccerfull.net/
    user-agent: "Mozilla/5.0 ..."
```

Profiles are loaded at backend startup (`ConfigService.getStreamingProfiles()`), so **adding or editing a profile requires a backend restart**.

## Adding a site

1. Open the page in a browser / `curl` it and find how it references its stream (a `.m3u8`/`.mp4` URL in the HTML or JS).
2. If `yt-dlp` already supports the site, you need **no profile** — unknown hosts fall back to `ytdlp` then `iframe`.
3. Otherwise drop a `<name>.yml` profile:
   - Reachable stream URL in the HTML → `strategy: scrape` with a `patterns` regex.
   - Nothing extractable, but the page embeds cleanly → `strategy: iframe`, `format: webview` (works only if the page sends no `X-Frame-Options`/CSP `frame-ancestors`).
4. Restart the backend.

Keep scrape `patterns` anchored and non-greedy — they run against fetched page HTML, so a catastrophically-backtracking regex is a (low, admin-controlled) ReDoS risk.

## Security notes

- The proxy enforces an **SSRF guard**: only `http`/`https`, and it rejects `localhost`/loopback/private/link-local/`*.local` hosts — re-checked on every redirect hop. Residual: DNS-rebinding (a public name resolving to a private IP) is not covered.
- `yt-dlp` is invoked via `execFile` with an argv array (no shell), so a crafted `stream:<url>` cannot inject shell commands.

## Layering

| Piece | Location |
|-------|----------|
| Format/result/profile value objects | `backend/src/2_domains/content/value-objects/Stream*.mjs` |
| `IStreamResolver` port | `backend/src/3_applications/content/ports/IStreamResolver.mjs` |
| `StreamAdapter` + resolvers (vendor code) | `backend/src/1_adapters/content/stream/` |
| Stream proxy (CORS / header injection / m3u8 rewrite) | `backend/src/4_api/v1/routers/proxy.mjs` (`GET /stream`) |
| Frontend HLS + iframe renderers | `frontend/src/modules/Player/renderers/{VideoPlayer,WebViewRenderer}.jsx` |
| Site profiles (data, not code) | `data/system/config/streaming/*.yml` |
