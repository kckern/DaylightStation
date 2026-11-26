# Share router

Anything shared from the phone (Android's share sheet → **Daylight**) arrives
through one intake. The backend finds the URL in the shared text and hands it to
the first handler that takes it. A handler belongs to the app that owns that
kind of thing. Today there is one handler: a **video link**, which plays on a
screen.

A shared video is **ephemeral**. It is fetched to temporary storage outside any
synced folder, played once on the target screen, and swept hours later. It is
not added to a library, a history or a watch-later list, and no playhead is kept
for it.

```
phone share sheet ─► ShareActivity (tap a screen) ─► quick-input text queue
   ─► POST /api/v1/share/to/<target>/text      (the quick-input intake contract)
   ─► ShareRouter: refuse if older than 10 min; first URL ─► handler.matches(url)
   ─► PlaySharedVideo.accept: job s<12 hex>
        ├─ source.fetch ─► fetch chain: 1. ytdlp-fetch service (VPN, PO tokens)
        │                                2. the app's own yt-dlp (container /tmp)
        │                   real progress; no progress for 150 s = given up
        │      not fetchable ─► 3. stream the same video (youtube:<id>)
        └─ wake-and-load <target> play=share:<job>   (at once)
   screen: Media's share intro holds the play request, polls GET /api/v1/share/jobs/<job>,
           draws the provider's provenance scene with the lines at the real progress
   ready ─► GET /api/v1/share/jobs/<job>/media (Range) ─► lines meet, video plays
   streaming ─► the stream's own media URL, under share:<job>
   failed / lost ─► failed scene 5 s ─► the Player abandons the play
```

## What the room sees

The target screen wakes and shows the provider's provenance scene straight away.
This is the same scene as before a film (`__docs/reference/media/provenance.md`),
but its lines **follow the real fetch**:

| Moment | Scene |
|---|---|
| Fetch running | The lines reach in as far as the bytes say: `progress × 44%` of the width each side. Each answer is eased over 420 ms |
| No bytes for 2.5 s (`PROGRESS_STALL_MS`) | The dots slow and dim (`--stalled`), then hop when bytes arrive again (`--resumed`) |
| File ready | The hold lifts, play info is fetched, the first frame is held 0.9 s (`SHARE_MIN_HOLD_MS`), then the lines meet and the logo docks, as for a film |
| Not fetchable, streamed instead | The hold lifts the same way; the video plays from the stream |
| Failed, or lost | The lines pull back, the dots go and the logo dims (`--failed`). After 5 s (`SHARE_FAILED_SHOW_MS`) the play is abandoned and the screen goes back to what it was showing. The backend also stops the screen 8 s after a failure, as a backstop, and notifies the person who shared |

The progress is real: it comes from yt-dlp's own byte counts. A merged download
fetches video then audio, so the first stream maps onto 0–0.9 and the second onto
0.9–1. The progress never goes back, and never reads 1 before the file is there.
After a failover to the next fetcher the lines hold where they were until the new
fetch passes them.

## Failover

| What goes wrong | What happens |
|---|---|
| The fetch service is not configured, cannot be reached, or fails the video | The app's own yt-dlp fetches it (`FailoverVideoFetcher`) |
| Neither fetcher fetches it (YouTube refuses, both down) | It is **streamed**: the job turns `streaming` and plays the `youtube:` content source's item for the same video (Piped, then yt-dlp streaming, then the embed) |
| The video is over 3 h or 6 GB | Not fetched at all (`--match-filter`, `--max-filesize`); streamed |
| No new bytes: 90 s in a fetcher, 150 s for the job (`SHARE_STALL_MS`) | The fetch is cancelled (the whole chain, through an abort signal) and the video is streamed |
| The video is unavailable (private, removed, members-only) | Not streamed (it would only reach its error page): the job fails |
| Nothing to stream either | The job fails: failed scene, the play is abandoned, the sharer is notified |
| The screen does not wake or load | The job fails, the fetch is cancelled, the sharer is notified |
| The app restarts mid-share | A video the fetch service already holds is **adopted** again: status, media and the `share:` item ask the sources (`stored(name)`). A fetch the app itself was running is lost: the intro sees `404 gone` for 6 s, shows the failed scene and abandons the play |
| The phone queued the share offline and sends it later | Refused if it was made more than 10 min ago (`SHARE_MAX_AGE_MS`, from the phone's `X-Daylight-Recorded-At`): `422`, the phone parks it. A video does not start on a screen hours after it was shared |
| The phone retries the same input | `duplicate: true`, nothing starts twice |

## The fetch service

`_extensions/ytdlp-fetch/` (`server.mjs`, `Dockerfile`, `docker-compose.yml`) is
yt-dlp as a small HTTP service in the `ytdlp` sidecar. The sidecar shares the
`vpn` container's network namespace, so every fetch leaves through the VPN, with
PO tokens from `ytdlp-pot`. The video stays in the service's own storage
(`/fetch`, on bulk storage outside Dropbox), and the app streams it from there. It
sweeps files after 6 h and keeps finished files across its own restarts.

| Route | What |
|---|---|
| `GET /health` | `{ ok, ytdlp, running, queued, jobs }` |
| `POST /fetch` `{ name, url, maxHeight }` | Start (or find) a fetch. `name` is the share job id; `url` must be https on an allowed host |
| `GET /fetch/<name>` | `{ state: queued \| downloading \| ready \| failed, progress, title, duration, size, error }` |
| `GET /fetch/<name>/file` | The mp4, with Range |
| `DELETE /fetch/<name>` | Stop it and delete the file |

The app finds it at `services.ytdlp_fetch` (system services config, per host),
or `YTDLP_FETCH_URL`. With neither, only the app's own yt-dlp is used.

**Never under the media mount.** The app's `media` folder is inside Dropbox, so
anything fetched there would be uploaded. The app's own fetcher writes to
`/tmp/daylight-share` in the container. That is not a mount, and it is lost when
the container is recreated.

## Config

`data/household/share/config.yml` (registry key `share` in `shared/contracts/householdConfig.mjs`):

```yaml
default_target: livingroom-tv     # where POST /api/v1/share/text plays
targets:                          # every screen a share may go to (devices.yml ids)
  livingroom-tv: { label: Living room TV }
  office-tv: { label: Office }
quick_input:                      # optional, the shared allowance (defaults 60 inputs, 200 MB a day)
  daily_inputs: 60
```

With no file, the living-room TV is the only target. Each target gets its own
intake path. A target added to `share/config.yml` needs a restart, and a matching
destination line on the phone. A target must be a screen that loads the Media
app's intro (the screen framework does). Elsewhere nothing would hold the play
request.

The device that sends must be bound for shares in `hardware/devices.yml`:

```yaml
devices:
  phone:
    quick_input:
      share: [<username>]
```

## HTTP

| Route | What |
|---|---|
| `POST /api/v1/share/text` | A share for the default target. The body is the shared text (`text/plain`). It is a [quick-input intake](quick-input.md): same headers, answers, allowance and once-only rule |
| `POST /api/v1/share/to/<target>/text` | The same, for one configured target |
| `GET /api/v1/share/targets` | `{ defaultTarget, targets: [{ id, label }] }` |
| `GET /api/v1/share/jobs/<job>` | `{ id, kind, state: downloading \| ready \| streaming \| failed, progress, title, failed, provenance: { provider, logo, accent } }`. `404 { state: 'gone' }` for a job nobody holds |
| `GET /api/v1/share/jobs/<job>/media` | The fetched video, with Range. `404` until it is fetched |

A share is accepted with `200 { ok, inputId, duplicate: false, share: { kind, provider, jobId, target } }`.
A share whose text holds no URL, a URL no handler takes, or a share older than
10 minutes is refused for good with `422 unusable_input`, and the phone parks it.

The intake paths are listed in app.mjs's `exceptPaths` through
`shareSelfGuardedPaths(configService)`, so the app-wide CORS handler and body
parsers stay off them. The router is mounted by the `/share` row of the route
table in `4_api/v1/routers/api.mjs`.

## Pieces

| Layer | File | What |
|---|---|---|
| Domain | `__app_modules/household/share/server/domain/sharePolicy.mjs` | `share/config.yml`, the first URL in shared text, intake paths |
| Application | `household/share/server/application/ShareRouter.mjs` | Stale check, URL → first matching handler, status and media. Knows no service by name |
| Application | `household/share/server/application/shareQuickInputs.mjs` | One quick-input intake per target (bot `share`, kind text), over one ledger |
| API | `household/share/server/api/share.mjs` | The routes above |
| Application | `media/media/server/application/share/PlaySharedVideo.mjs` | The video handler: job, fetch, stream fallback, stall deadline, screen load, adoption after a restart, failure handling |
| Application | `media/media/server/application/share/ports/ISharedVideoSource.mjs` | `recognize`, `fetch` (→ an opaque media resource), `stored`, `cancel`, `streamContentId` |
| Application | `media/media/server/application/share/ShareJobs.mjs` | Jobs in memory |
| Adapter | `__backend/src/1_adapters/content/media/youtube/YouTubeSharedVideoSource.mjs` | YouTube links (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`) → video id; fetch through the chain from the watch URL rebuilt from the id; stream fallback `youtube:<id>` |
| Adapter | `__backend/src/1_adapters/video/YtDlpFetchServiceAdapter.mjs` | Client of the fetch service; media streamed from it |
| Adapter | `__backend/src/1_adapters/video/LocalVideoFetcher.mjs` | The app's own yt-dlp (`YtDlpAdapter.downloadOne`) into `/tmp/daylight-share`; hourly sweep |
| Adapter | `__backend/src/1_adapters/video/FailoverVideoFetcher.mjs` | Fetchers in order; too large or cancelled is final |
| Adapter | `media/media/server/adapters/YtDlpAdapter.mjs` `downloadOne` | One video to an exact `.mp4`, progress template, 90 s stall, length and size limits; argv array, never a shell |
| Adapter | `__backend/src/1_adapters/content/media/share/ShareContentSource.mjs` | `share:<job>`: queueable from the moment of the share; the job's media route, or the stream's item when streaming; `metadata.ephemeral`. A failed job is no item |
| Composition | `media/media/server/composition/share.mjs`, `household/share/server/composition/share.mjs` | Wiring. The only place that names the YouTube source and the fetchers |
| Browser | `media/media/browser/share/useShareIntro.jsx` | The intro for `share:` ids: polls the job (700 ms), holds the play request, abandons a failed or lost share |
| Browser | `media/media/browser/provenance/ProvenanceHandoff.jsx` | `progress` and `failed` props |
| Player | `__capabilities/playback/browser/player/components/SinglePlayer.jsx` | `intro.holdRequest` (no play-info fetch while held), `intro.abandon` (advance past the title) |
| Service | `_extensions/ytdlp-fetch/` | The fetch service and its image |

Only the adapters know which service a link is from. The share router, the use
case and the browser code see a `provider` string, which picks a logo and accent
from the provenance config (`services`).

Adding a source (another video site): write an `ISharedVideoSource` adapter and add
it to `sources` in `media/media/server/composition/share.mjs` (and the host to the
fetch service's `ALLOWED_HOSTS`). Adding a kind (a photo, a recipe page): register
another handler in app.mjs's share block.

## Logs

`share.ready` (boot: targets, handlers), `share.fetchers` (boot: the chain),
`share.stale` (`ageS`), `share.routed` (`kind`, `target`), `share.unrouted` (`host`
only), `share.video.accepted` (`jobId`, `provider`, `sourceId`, `target`),
`share.video.fetch-attempt` (`fetcher`, `n`), `share.fetch.failed` /
`share.fetch.unreachable` (`fetcher`, `reason`), `share.video.progress` (debug,
every 25%), `share.video.ready`, `share.video.streaming` (`reason`),
`share.video.stalled`, `share.video.adopted`, `share.video.screen-loaded`,
`share.video.failed` (`stage: fetch | screen`), `share.temp.swept`. yt-dlp:
`ytdlp.single.start | done | failed`. Screen: component `share-intro`,
`share-intro.start | ready | streaming | failed | gone | abandon`; the Player's
`intro-abandoned`. The fetch service logs JSON lines to its container
(`docker logs ytdlp`).

Nothing of the shared text is logged beyond the URL's host on a refusal.

## Phone

`ShareActivity` in the `quick-input` capability. See "Sharing from other apps" in
`__docs/reference/android/phone.md`.
