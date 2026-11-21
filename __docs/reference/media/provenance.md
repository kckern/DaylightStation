# Provenance bumper

Before a movie or show starts, the player can name the streaming service it is
"from": the service's logo on a dark field, two lines reaching in from either side
with dots pulsing between them, then, when the film starts, the lines meet, the field
clears and the logo shrinks into the top-right corner and fades. There are no words
on screen.

It appears only for **confirmed** availability, and by default only before
**movies** (`kinds: [movie]`; add `show` for TV). The player hook is installed for
every player that loads the Media entry, Fitness, Piano and School included, so
shows are opt-in to keep a workout or lesson episode from getting a service intro. A title found on no known service,
one whose lookup has not finished by the first frame, or a resume shows nothing.

Later this is meant to front real handoffs to those services; today the film still
plays from Plex and the bumper signals provenance only.

## What the viewer sees

| Phase | Video | Scene |
|---|---|---|
| `linking` (random 5–10 s per play) | held paused at the start | field covers the video at once; logo fades in; lines creep in from both edges in uneven bursts and stalls over the whole hold; three dots pulse in the gap |
| `linked` (~0.7 s) | resumed; begins on the video's `playing` | gap closes, a spark where the lines meet |
| `docked` (~4 s) | playing | field and lines dissolve; logo moves to the top-right corner at 80% opacity |
| `leaving` (~0.9 s) | playing | corner logo fades |

Lines and dots take the service's brand colour (`PROVIDER_ACCENTS` in
`ProvenanceHandoff.jsx`; white otherwise). Timings are `SCENE_TIMING` in
`useSceneTimeline.js`; the hold is drawn uniformly from `linkMinMs`–`linkMaxMs` once
per title, handed to the Player as the intro's `minHoldMs`, and passed to the scene as
`--ph-link-ms`, so the lines take exactly that long. The Player holds longer if the
video is still loading.

**Contrast.** When the logo preloads, the player measures it (`logoContrast.js`): the
mean relative luminance of its opaque pixels against the field, as a WCAG ratio. Under
3:1 (the large-graphics threshold) the logo rides on a light rounded plate, in the centre
and docked. Disney+'s navy wordmark (about 2.5:1) gets one; Netflix and Kanopy red do
not. A newly added dark logo gets a plate without any change.

**The Player gates it.** The scene is the Media app's *intro* in the shared Player's
intro slot (`useVideoIntro` in the playback presentation contract): `useProvenanceIntro`
reports `pending` while the provider is looked up, `ready` once the logo has loaded,
`none` otherwise, plus `minHoldMs` and a `render(stage)` callback. The Player's
`useIntroGate` owns all timing: it covers the spinner as soon as the intro is ready,
holds the first frame until `minHoldMs` is over, resumes, and moves to `playing`
(if resuming does not report `playing` within 2.5 s it moves on anyway). It shows
nothing on a resume (a requested start past 5 s) or when the answer arrives after the
film has rolled. `useSceneTimeline` maps the stage to the scene's phase:
`covering`/`holding` draw `linking`; entering `playing` runs `linked` → `docked` →
`leaving`. The content-filter bumper ("Edited for content") is held while the intro
is up and until the lines meet, so on a filtered title it follows the scene instead
of covering it.

`?provenance=0` on the page URL turns it off for that load.

## Choosing the service

A title's streaming offers are subscription (`sub`) and free (`free`) listings only;
rent and buy listings never count. The household's tiers decide which one wins:

1. **free** services, in configured order (Hoopla, Tubi, ...)
2. **subscribed** services, in configured order (Prime Video, Peacock)
3. any **other** known service, in the order found (Netflix, Disney+, ...)

A service qualifies only if it has a logo in `data/content/providers/`. Services
without a logo are recorded but not shown.

## Files

| What | Where |
|---|---|
| Household policy (tiers, refresh, reserve) | `data/household/media/provenance.yml` (registry key `provenance`) |
| Availability cache (machine-written) | `media/content-providers/availability.yml` |
| Logos | `data/content/providers/<id>.svg` or `.png`; `<id>.white.svg` for a black logo on the dark field; `sources.yml` records where each came from |
| API key | system auth `watchmode.yml` → `api_key` |

```yaml
# data/household/media/provenance.yml
enabled: true
kinds: [movie]        # add `show` for TV shows
lookup:
  region: US
  refresh_days: 30
  quota_reserve: 100
providers:
  free: [hoopla, tubi, pluto-tv, kanopy, roku-channel]
  subscribed: [prime-video, peacock]
```

Provider ids: `netflix`, `prime-video`, `hulu`, `disney-plus`, `peacock`, `hbo-max`,
`paramount-plus`, `apple-tv`, `tubi`, `pluto-tv`, `hoopla`, `kanopy`, `roku-channel`,
`amc-plus`, `philo`, `directv`. A few spellings map to these in `providerIdFor`
(domain); **any other service is identified by its name's slug** ("Sling TV" →
`sling-tv`, "AMC+" → `amc-plus`), so adding a service is only a matter of dropping
`<slug>.svg` into the providers folder. It is seen within a minute, and stored
records pick it up too: the provider is derived from the service name when the choice
is made. Policy edits need a restart (household config is cached).

## Lookups and the monthly allowance

Watchmode allows 2,500 credits a month, and a title lookup costs 2. There is no
library sweep. A title is looked up when it is about to play (the player asks on
mount), and the answer is cached:

- A movie or show is recorded under its own rating key; an episode or season under
  its show.
- Plex `Guid` entries give the id: IMDb when present, else a typed TMDB id
  (`movie-603`, `tv-1396`). No external id: recorded with `note: no external id`,
  no lookup spent.
- A record is reused for `refresh_days`, including "found nowhere" (`offers: []`).
- Watchmode's `X-Account-Quota-Used` header is stored as `usage`; lookups stop at
  `quota - quota_reserve` for the rest of the month (a stale record is still served).
- A failed lookup serves the stale record if there is one, else nothing.
- Concurrent plays of one title share one lookup.

An uncached lookup took 160 to 460 ms in testing; a cached answer a few
milliseconds. The bumper never waits for one: the first play of a title whose
answer is not in yet plays plain, and the next play has it.

## API

`/api/v1/provenance`:

- `GET /:ratingKey` (bare or `plex:`-prefixed) → `{ provenance: { ratingKey, provider, name, tier, offerType, checkedAt, logo } | null }`
- `GET /logo/:provider[?variant=white]` → the logo (white variant preferred when
  asked, else the base logo); cached for a day

## Code

| Layer | Path (under `__app_modules/media/media/`) |
|---|---|
| Domain rules | `server/domain/provenance/provenance.mjs` |
| Use case | `server/application/provenance/GetTitleProvenance.mjs`, ports in `ports/` |
| Adapters | `server/adapters/provenance/` (Watchmode, Plex identity, YAML store, logo catalog) |
| Route + wiring | `server/api/provenance.mjs`, `server/composition/provenance.mjs` |
| Player | `browser/provenance/` (`useProvenance`, `useProvenanceIntro`, `useSceneTimeline`, `ProvenanceHandoff`, `playbackPresentation.jsx`); installed by `browser/playback.mjs` as the Player's `useVideoIntro` |

The Player hides its own spinner while the intro covers, so Media's loading-suppression
store is only the content filter's skip card.

## Logs

Backend (`context.module: provenance`): `provenance.lookup.done` (providers found,
`quotaUsed`), `provenance.lookup.failed`, `provenance.lookup.quota-reserved`,
`provenance.lookup.no-external-id`, `provenance.disabled` (no key or no Plex at boot).

Frontend (`component: provenance`): `provenance.ready`, `provenance.none`,
`provenance.fetch.failed`, `provenance.logo.failed`. The gate itself logs from the
Player (`component: intro-gate`): `intro.covering`, `intro.holding` (debug),
`intro.playing`, `intro.off` (debug), `intro.resume-refused`.
