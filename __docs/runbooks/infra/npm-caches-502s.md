# The reverse proxy caches 502s

**Symptom.** An asset returns 502 through `daylightlocal.kckern.net` while the
same path returns 200 on `localhost:3111`, and keeps doing so for hours. The 502
carries no upstream headers at all — no `X-Powered-By`, no `X-Served-By` — and
adding any query string to the URL returns 200.

**Cause.** Nginx Proxy Manager has asset caching enabled for proxy host 17
(`include conf.d/include/assets.conf`) and it stores **502** responses. Every
deploy stops the container for ~45 seconds; anything requested at a stable URL
during that window is cached as a 502 under that URL's key and served to
everyone afterwards.

Its own access log is the proof — the first field is `$upstream_cache_status`:

```
[11/Sep/2026:21:44:55 +0000] HIT - 502 - GET https daylightlocal.kckern.net "/sw.js" [Length 584]
```

On 2026-09-11 this served a cached 502 for `/favicon.ico` **1294 times**, for
`/sw.js` 33 times (long enough that the service worker had never once
registered), and for two instrument SVGs. Every poisoning timestamp is inside a
deploy window.

**Why hashed assets are immune.** `index-BRX-JNUg.js` gets a new key every
build, so a poisoned one is simply never asked for again. Only assets shipped
under a stable name can be poisoned across a deploy.

## What the app already does

Stable-URL assets carry the build id (`/sw.js?v=<build>`, injected into
`index.html` by a Vite plugin — see `frontend/vite.config.js`), giving them the
same immunity the bundles have. The favicon is declared explicitly for the same
reason: undeclared, browsers request the bare `/favicon.ico` implicitly, and an
implicit request cannot be versioned.

This stops the app asking for poisoned keys. **It does not stop the proxy
creating them** — any stable URL, including ones we do not control, is still
exposed.

## The actual fix (needs root)

`proxy_cache_valid` must cover success and not-found only. Add to
`/data/nginx/custom/server_proxy.conf` inside the NPM container's data volume —
on this host `…/Docker/System/reverse_proxy/nginx/custom/server_proxy.conf` —
and reload:

```nginx
# Never cache an upstream failure. A deploy takes the container away for ~45s;
# without this, anything requested at a stable url in that window is stored as a
# 502 and served to everyone until it is evicted.
proxy_cache_valid 200 304 1h;
proxy_cache_valid 404 1m;
proxy_cache_valid 500 502 503 504 0;
```

```bash
docker exec domains nginx -t && docker exec domains nginx -s reload
```

Verify — a poisoned key must go from `HIT … 502` to a live 200, and the log's
first field must stop reading `HIT` for error responses:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://daylightlocal.kckern.net/sw.js
grep -c 'HIT - 50[0-9]' …/reverse_proxy/logs/proxy-host-17_access.log
```

The already-poisoned entries are not purged by this; they expire, or the key
stops being requested. There is no purge endpoint — NPM's nginx has no
`ngx_cache_purge`, and no request-side bypass is configured (`Cache-Control:
no-cache`, `Pragma`, and an `Upgrade` header were all tried and all returned the
cached 502).

## Access

The `claude`/`ds` account cannot do any of this: sudo is scoped to
`docker exec daylight-station` and `docker exec plex`, with no exec, restart or
config write for `domains`, and the NPM data volume is root-owned.
