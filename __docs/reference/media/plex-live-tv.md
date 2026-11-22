# Plex live TV channels (`plex-live:`)

Plex's free ad-supported channels, the ones on `watch.plex.tv/live-tv` (NFL
Channel and about 700 others), play anywhere a content id plays:

```
plex-live:nfl-channel      the NFL Channel
plex-live:                 every playable channel (a list)
```

The slug is the last part of the channel's watch.plex.tv URL:
`https://watch.plex.tv/live-tv/channel/nfl-channel` → `plex-live:nfl-channel`.
Sending one to a screen:

```bash
curl -s "{app}/api/v1/device/<device>/load?play=plex-live:nfl-channel"
```

In a menu YAML, a channel is an ordinary entry (the space after the colon is
fine; source names may contain hyphens):

```yaml
- input: 'plex-live: nfl-channel'
  label: NFL Channel
```

The tile art is the channel's vertical poster (`getThumbnailUrl`), else its
logo. The lineup follows the server's region; for Seattle it carries Local Now
Seattle (`local-now-seattle`) but none of the broadcast stations.

## Where it comes from

These channels are **not served by our Plex Media Server**. They come from
Plex's cloud at `epg.provider.plex.tv`, and the same account token that reaches
our server reaches them (`household/auth/plex.yml`). No tuner, DVR or Plex Pass
feature is involved. Without a Plex token neither the source nor the proxy is
registered.

A channel's stream is plain HLS, no DRM:

| Step | Host | Through us? |
|------|------|-------------|
| Master playlist `/library/parts/<id>.m3u8` | epg.provider.plex.tv | yes, rewritten |
| Variant playlist `/library/parts/<id>/variant.m3u8` | epg.provider.plex.tv | yes, rewritten |
| 6 s `.ts` segments | third-party CDN, signed URLs, `access-control-allow-origin: *` | no, the screen fetches them directly |

## The token in the playlist

Plex writes the account token in clear text into the variant URL inside the
master playlist (`x-plex-token=…`, lower case). Handed to a browser as-is, every
screen and every log line would hold the account token. So the proxy rewrites
every playlist before it leaves:

- the token is removed from every URL, any host, any case;
- URLs on `epg.provider.plex.tv` point back through `/api/v1/proxy/plex-live/…`,
  where the proxy adds the token upstream again;
- CDN segment URLs stay absolute (they carry no token).

The proxy also refuses (404, upstream never contacted) anything outside
`/library/parts/…`: the token opens the whole account API on plex.tv, and the
proxy exposes only channel media.

## Pieces

| Piece | File |
|-------|------|
| Proxy adapter (`plex-live` service, playlist rewrite, path gate) | `__backend/src/1_adapters/proxy/PlexLiveTvProxyAdapter.mjs` |
| Proxy hooks it uses (`getBodyRewriter`, `allowsPath`) | `__backend/src/0_system/proxy/ProxyService.mjs`, `IProxyAdapter.mjs` |
| Lineup reader (`GET /lineups/plex/channels`, token in a header) | `__backend/src/1_adapters/content/media/plex-live/PlexLiveTvLineup.mjs` |
| Content source (`plex-live:<slug>` → item) | `__backend/src/1_adapters/content/media/plex-live/PlexLiveTvContentSource.mjs` |
| Registration | `registerPlexLiveTvProvider` in `__app_modules/media/media/server/composition/content-providers.mjs`; proxy in `5_composition/bootstrap.mjs` |
| Route | `/api/v1/proxy/plex-live/*` in `4_api/v1/routers/proxy.mjs` |

The item is `mediaType: hls_video`, `duration: null`, `resumable: false`,
`metadata.live: true`, so the Player plays it through hls.js. The Player still
reports progress against the live window (about 90 s); `RecordPlaybackProgress`
sees `metadata.live` and stores no playhead, completion or media-server session
for it. The play still appears in the screen's play ledger (`play.log.updated`
carries `live: true`). Art: `thumbnail` is the channel logo,
`imageUrl` the vertical poster, `metadata.art` the background (all public
`provider-static.plex.tv` URLs).

The lineup is cached for 6 hours. Only visible, non-DRM HLS channels are kept.
If a refresh fails the stale lineup keeps serving and the next attempt waits a
minute.

## Logs

| Event | Meaning |
|-------|---------|
| `plex-live.lineup.loaded` | lineup fetched (`channels`, `listed`) |
| `plex-live.lineup.failed` | lineup fetch failed (`stale` says whether an old one is serving) |
| `plex-live.channel.resolved` / `.not-found` | a `plex-live:<slug>` lookup |
| `proxy.path-refused` | something asked the proxy for a path outside `/library/parts/` |
| `proxy.rewrite.failed` | a playlist could not be rewritten (answered 502) |
