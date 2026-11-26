# Share router

Anything shared from the phone (Android's share sheet → **Daylight**) arrives
through one intake. The backend finds the URL in the shared text and hands it to
the first handler that takes it. A handler belongs to the app that owns that
kind of thing. Today there is one handler: a **video link**, which plays on a
screen.

A shared video is **ephemeral**. It is fetched to temp storage on the media
mount, played once on the target screen, and swept hours later. It is not added
to a library, a history or a watch-later list, and no playhead is kept for it.

```
phone share sheet ─► ShareActivity (tap a screen) ─► quick-input text queue
   ─► POST /api/v1/share/to/<target>/text      (the quick-input intake contract)
   ─► ShareRouter: first URL in the text ─► handler.matches(url)
   ─► PlaySharedVideo.accept: job s<12 hex>
        ├─ source.fetch(...)  ─► media/tmp/share/<job>.mp4   (real progress)
        └─ wake-and-load <target> play=share:<job>   (at once)
   screen: Media's share intro holds the play request, polls GET /api/v1/share/jobs/<job>,
           draws the provider's provenance scene with the lines at the real progress
   file ready ─► hold lifts ─► Player asks /play/share:<job> ─► lines meet, video plays
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
| Fetch failed | The lines pull back, the dots go and the logo dims (`--failed`). The backend stops the screen 8 s later (`SHARE_FAILURE_HOLD_MS`) and notifies the person who shared |

The progress is real: it comes from yt-dlp's own byte counts. A merged download
fetches video then audio, so the first stream maps onto 0–0.9 and the second onto
0.9–1. The progress never goes back, and never reads 1 before the file is there.

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
destination line on the phone.

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
| `GET /api/v1/share/jobs/<job>` | `{ id, kind, state: downloading \| ready \| failed, progress, title, failed, provenance: { provider, logo, accent } }`. `404 { state: 'gone' }` for a job the server no longer has |

A share is accepted with `200 { ok, inputId, duplicate: false, share: { kind, provider, jobId, target } }`.
A share whose text holds no URL, or a URL no handler takes, is refused for good
with `422 unusable_input`, and the phone parks it. A retry of the same input id
answers `duplicate: true` and starts nothing.

The intake paths are listed in app.mjs's `exceptPaths` through
`shareSelfGuardedPaths(configService)`, so the app-wide CORS handler and body
parsers stay off them.

## Pieces

| Layer | File | What |
|---|---|---|
| Domain | `__app_modules/household/share/server/domain/sharePolicy.mjs` | `share/config.yml`, the first URL in shared text, intake paths |
| Application | `household/share/server/application/ShareRouter.mjs` | URL → first matching handler. Knows no service by name |
| Application | `household/share/server/application/shareQuickInputs.mjs` | One quick-input intake per target (bot `share`, kind text), over one ledger |
| API | `household/share/server/api/share.mjs` | The routes above |
| Application | `media/media/server/application/share/PlaySharedVideo.mjs` | The video handler: job, fetch, load the screen, failure handling |
| Application | `media/media/server/application/share/ports/ISharedVideoSource.mjs` | `recognize(url) → { provider, sourceId }`, `fetch(sourceId, { outputPath, onProgress })` |
| Application | `media/media/server/application/share/ShareJobs.mjs` | Jobs in memory (ephemeral; a restart forgets them) |
| Adapter | `__backend/src/1_adapters/content/media/youtube/YouTubeSharedVideoSource.mjs` | YouTube links (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`) → video id; fetch through yt-dlp from the watch URL rebuilt from the id |
| Adapter | `media/media/server/adapters/YtDlpAdapter.mjs` `downloadOne` | One video to an exact `.mp4` with a progress template; argv array, never a shell |
| Adapter | `__backend/src/1_adapters/content/media/share/ShareContentSource.mjs` | `share:<job>`: a ready job as a playable item at `/api/v1/proxy/media/stream/tmp/share/<job>.mp4`, `metadata.ephemeral` |
| Adapter | `__backend/src/1_adapters/content/media/share/ShareTempStore.mjs` | `<media>/tmp/share/`, swept hourly (files older than 6 h whose job is gone) |
| Composition | `media/media/server/composition/share.mjs`, `household/share/server/composition/share.mjs` | Wiring. The only place that names the YouTube source |
| Browser | `media/media/browser/share/useShareIntro.jsx` | The intro for `share:` ids: polls the job (700 ms), holds the play request, draws the scene |
| Browser | `media/media/browser/provenance/ProvenanceHandoff.jsx` | `progress` and `failed` props |
| Player | `__capabilities/playback/browser/player/components/SinglePlayer.jsx` | `intro.holdRequest`: no play-info fetch while the intro holds |

Only the adapters know which service a link is from. The share router, the use
case and the browser code see a `provider` string, which picks a logo and accent
from the provenance config (`services`).

Adding a source (another video site): write an `ISharedVideoSource` adapter and add
it to `sources` in `media/media/server/composition/share.mjs`. Adding a kind
(a photo, a recipe page): register another handler in app.mjs's share block.

## Logs

`share.ready` (boot: targets, handlers), `share.routed` (`kind`, `target`),
`share.unrouted` (`host` only), `share.video.accepted` (`jobId`, `provider`,
`sourceId`, `target`), `share.video.progress` (debug, every 25%),
`share.video.ready` (`ms`, `duration`), `share.video.screen-loaded`,
`share.video.failed` (`stage: fetch | screen`, `error`), `share.temp.swept`.
yt-dlp: `ytdlp.single.start | done | failed`. Screen: component `share-intro`,
`share-intro.start | ready | failed | gone | logo-failed`.

Nothing of the shared text is logged beyond the URL's host on a refusal.

## Phone

`ShareActivity` in the `quick-input` capability. See "Sharing from other apps" in
`__docs/reference/android/phone.md`.
