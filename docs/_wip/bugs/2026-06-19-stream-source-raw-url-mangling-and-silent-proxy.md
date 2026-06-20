# Stream Source: Raw-URL `stream:https://…` Mangled (`//`→`/` + query dropped) + Silent Proxy/Resolver Logging

**Filed:** 2026-06-19
**Deployed in:** `d4857b861 merge: integrate online stream sources with fitness cycle/fingerprint work`
**Client:** Living-room screen (`/screens/living-room`), Chrome `149.0.0.0` (IP `172.18.0.70`); also reproduced from garage Firefox
**Files referenced:**
- `backend/src/1_adapters/content/stream/streamUrlCodec.mjs`
- `backend/src/1_adapters/content/stream/StreamAdapter.mjs`
- `backend/src/1_adapters/content/stream/resolvers/ScrapeStreamResolver.mjs`
- `backend/src/1_adapters/content/stream/resolvers/YtDlpStreamResolver.mjs`
- `backend/src/4_api/v1/routers/proxy.mjs` (`/proxy/stream`, `rewriteHlsPlaylist`)

---

## TL;DR

Three findings from manually exercising the new `stream:` source via `?play=stream:…` on the living-room screen.

1. **Raw `stream:https://…` URLs are silently corrupted before any resolver sees them.** Express path routing collapses `//`→`/` and the embedded URL's query string is dropped. `stream:https://www.youtube.com/watch?v=F1sMvm6D-0Y` reaches the YtDlp resolver as `https:/www.youtube.com/watch` — no double slash, **no `?v=` video ID** — and yt-dlp dies with `Invalid URL 'https:///www.youtube.com/watch': No host supplied`. The canonical, working form is `stream:<base64url-token>` (see `streamUrlCodec.encodeStreamUrl`); raw URLs only "work" when the resolver happens to reconstruct the URL by scraping (soccerfull.net did), and never work when the identity lives in the query string (YouTube).

2. **The proxy and resolver-selection paths are effectively unlogged**, so a bad-content failure is indistinguishable from a pipeline failure without leaving the system to `curl`. Diagnosing finding #3 required manually fetching the upstream manifest and the proxy endpoint — nothing in the logs described what the proxy fetched or what the resolver selected.

3. **(Content, not a code bug — recorded for context)** `soccerfull.net/play/14360` resolves to a decoy HLS manifest: 369 segments, 100% TikTok ad-CDN `.image` JPEGs, zero video. hls.js can't parse JPEGs as media → `startup-deadline-exceeded` → infinite hard-reset loop. The pipeline behaved correctly; the scraped m3u8 was a honeypot.

**Workaround (today):** always emit `stream:<base64url>` using `encodeStreamUrl`. Example that works:
`…/screens/living-room?play=stream:aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g_dj1GMXNNdm02RC0wWQ`
(= base64url of `https://www.youtube.com/watch?v=F1sMvm6D-0Y`).

---

## 1. Raw-URL mangling (the real bug)

### Evidence

YouTube attempt — input `?play=stream:https://www.youtube.com/watch?v=F1sMvm6D-0Y`:

```json
{"event":"stream.ytdlp.probe_failed","data":{"url":"https:/www.youtube.com/watch",
  "error":"Command failed: yt-dlp … https:/www.youtube.com/watch\nERROR: Invalid URL 'https:///www.youtube.com/watch': No host supplied\n"}}
{"event":"queue.resolve","data":{"source":"stream","localId":"https:/www.youtube.com/watch","count":0}}
{"event":"playback.queue-init-empty","data":{"payload":{"contentRef":"stream:https://www.youtube.com/watch?v=F1sMvm6D-0Y"}}}
```

Two distinct corruptions of the embedded URL:
- **`//` → `/`**: `https://www.youtube.com` arrives as `https:/www.youtube.com`. Path normalization (Express / proxy) collapses the double slash.
- **Query string dropped**: `?v=F1sMvm6D-0Y` is gone — the localId is just `https:/www.youtube.com/watch`. The screen route's own query parser consumed `?v=…` as part of the *screen* URL, not the embedded stream URL. For YouTube this is fatal: the video identity lives entirely in the query string.

Earlier soccerfull attempt showed the same `//`→`/` collapse, masked because the scrape resolver rebuilt a clean URL:

```json
{"event":"play.source.unknown","data":{"compoundId":"stream:https:/soccerfull.net/play/14360","source":"stream:https:","rawPath":"/soccerfull.net/play/14360"}}
…
{"event":"queue.resolve","data":{"source":"stream","localId":"https:/soccerfull.net/play/14360","count":1}}
{"event":"video.hls.native","data":{"mediaUrl":"/api/v1/proxy/stream?src=https%3A%2F%2Fsoccerfull.net%2Fhls%2F14360.m3u8&profile=soccerfull"}}
```

Note the frontend `waitKey` for soccerfull was `stream:aHR0cHM6Ly9zb2NjZXJmdWxsLm5ldC9wbGF5LzE0MzYw` — base64url of `https://soccerfull.net/play/14360`. The frontend already speaks the encoded form; the failures all came from feeding a **raw** URL in the address bar.

### Root cause

`streamUrlCodec.mjs` is explicit that base64url is the contract:

```javascript
// base64url so a URL survives Express path routing inside `stream:<token>`.
export function encodeStreamUrl(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}
export function decodeStreamUrl(token) {
  if (/^https?:\/\//i.test(token)) return token; // already a raw url (defensive)
  …
}
```

`decodeStreamUrl`'s raw-URL branch is a **defensive fallback that cannot actually hold** — by the time the token reaches it, Express has already collapsed `//` and the screen route has already eaten the query string. So the "accept a raw URL too" affordance is a trap: it appears supported, silently corrupts the URL, and only survives for URLs that (a) have no query string and (b) get reconstructed downstream by scraping.

### Fix options

- **Producer-side (preferred):** every code path that emits `?play=stream:…` links (admin UI, content config, any link generator) must call `encodeStreamUrl`. Audit for raw `stream:http` string concatenation. Confirm the admin/link UI never emits a raw URL.
- **Decoder-side hardening:** make the raw-URL fallback either (a) reject with a clear `stream.token.raw_url_rejected` warning telling the caller to base64url-encode, or (b) reconstruct from `req.originalUrl` (preserving `//` and the full query string) instead of the normalized path — so a hand-typed raw URL at least fails loudly or works correctly rather than silently dropping the video ID.
- **Either way:** the current behavior (silent corruption → empty queue) is the worst outcome.

---

## 2. Silent proxy / resolver logging

Diagnosing finding #3 required leaving the app and running `curl` against the upstream and the proxy, because the relevant steps log nothing.

| Step | Current logging | Gap |
|------|-----------------|-----|
| Resolver selection | `ScrapeStreamResolver` logs only `stream.scrape.fetch_failed` on error (`ScrapeStreamResolver.mjs:22`). YtDlp logs `stream.ytdlp.probe_failed`. | On **success**, nothing logs which page was scraped, what candidate m3u8s were found, or which was selected. |
| Proxy fetch | `proxy.mjs` `/stream` handler and `rewriteHlsPlaylist` (`proxy.mjs:141`) emit no structured logs — only `console.error` on some upstream catches. | No `upstreamStatus`, `contentType`, or `bytes` for the proxied manifest/segments. |
| Manifest content sanity | none | The single most diagnostic fact — "369 segments, all `.image`, 0 media" — is computed nowhere. |
| hls.js errors (frontend) | `player-remount {reason:"startup-deadline-exceeded"}`, `stream-url-refreshed {reason:"hard-reset-with-refresh"}` | These are *symptoms*. The underlying hls.js `ERROR` events (`fragParsingError` / `bufferAppendError`) — the *cause* — are not surfaced. |

### Recommended log points

- `stream.resolve.selected { pageUrl, mediaUrl, strategy }` in the resolver success path.
- `proxy.stream.fetch { src, upstreamStatus, contentType, bytes }` in `/proxy/stream`.
- `proxy.stream.manifest { segmentCount, mediaExtCount, nonMediaExtCount, sampleHosts }` inside `rewriteHlsPlaylist` — a manifest is already fully parsed there, so the segment-type tally is nearly free. This one line would have made finding #3 self-diagnosing.
- Wire hls.js `Hls.Events.ERROR` into the logger in the HLS player component.

Contrast: the YtDlp path **was** adequately logged — `stream.ytdlp.probe_failed` carried the mangled `https:/www.youtube.com/watch`, which is exactly how finding #1 was caught. The proxy path should reach the same standard.

---

## 3. soccerfull.net decoy manifest (content, for context)

Not a DaylightStation defect; recorded so the next investigator doesn't re-debug the pipeline.

Upstream `https://soccerfull.net/hls/14360.m3u8` returns HTTP 200, `application/vnd.apple.mpegurl`, 81 KB, but:

```
total segment lines:     369
unique hosts:            236 p16-ad-site-sign-sg.tiktokcdn.com
                         133 p19-ad-site-sign-sg.tiktokcdn.com
file extensions:         369 .image
```

Every segment is a TikTok ad-CDN `tplv-d5opwmad15-ttam-origin.image` JPEG; the playlist ends `#EXT-X-ENDLIST`. There is no video anywhere in the manifest.

Resulting frontend behavior — pipeline resolves cleanly, then the player loops forever:

```json
{"event":"queue.resolve","data":{"source":"stream","localId":"https:/soccerfull.net/play/14360","count":1}}
{"event":"video.hls.native","data":{"mediaUrl":"/api/v1/proxy/stream?src=…14360.m3u8&profile=soccerfull"}}
{"event":"playback.player-remount","data":{"payload":{"reason":"startup-deadline-exceeded"}}}   ← repeats every ~15s
```

The scrape resolver grabbed the site's honeypot/ad preroll m3u8 rather than the real match stream (these pirate sports sites commonly gate the real stream behind a JS-computed token/referer). Out of scope for the bugs above; worth a separate note on resolver candidate-ranking if soccerfull-class sources are intended to be supported.

---

## Repro

```
# Broken (raw URL): empty queue, yt-dlp "No host supplied"
…/screens/living-room?play=stream:https://www.youtube.com/watch?v=F1sMvm6D-0Y

# Works (base64url token): resolves + plays
…/screens/living-room?play=stream:aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g_dj1GMXNNdm02RC0wWQ
```

Generate the token:
```bash
node -e 'console.log("stream:"+Buffer.from(process.argv[1],"utf8").toString("base64url"))' "https://www.youtube.com/watch?v=F1sMvm6D-0Y"
```

---

## Suggested priority

1. **Producer audit** — guarantee all `?play=stream:` link generators use `encodeStreamUrl` (prevents the class of failure entirely). *High.*
2. **Decoder hardening** — raw-URL fallback should fail loudly or reconstruct from `req.originalUrl`, not silently corrupt. *Medium.*
3. **Proxy/resolver logging** — `proxy.stream.fetch` + `proxy.stream.manifest` + resolver `selected` + hls.js `ERROR`. *Medium* (pure observability, prevents future `curl`-to-diagnose).
