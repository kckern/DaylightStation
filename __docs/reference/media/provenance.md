# Provenance scene

Before a movie or show starts, the player can name the streaming service it is
"from": the service's logo on a dark field, two lines reaching in from either side
with dots pulsing between them, then, when the film starts, the lines meet, the field
clears and the logo shrinks into the top-right corner and fades. There are no words
on screen.

Which service is shown is decided by the household's **rules** (see "Choosing the
service"): overrides, then the availability service's offers by priority group, then
fallbacks, so every title in scope can be represented even when the availability
service knows nothing about it. Scope is `kinds` (movies and shows; a show maps at the
show level, so every episode of Ted Lasso gets Apple TV) and `libraries` (by name;
Home Video Archive and Fitness stay out). The playback presentation contract is
page-global: the intro is installed for every player on a page that loaded the Media
entry, Fitness, Piano and School included, so the server-side scope is the guard. A
title out of scope, one whose answer is not in before the film has rolled 1 s, a
resume (unless after a long absence), or a recovery remount mid-film shows nothing.

Later this is meant to front real handoffs to those services; today the film still
plays from Plex and the bumper signals provenance only.

## What the viewer sees

| Phase | Video | Scene |
|---|---|---|
| `linking` (random 5–10 s per play) | loading, or held on its first frame | field covers the video at once; logo fades in; lines creep in from both edges, with a new motion every play (below); three dots pulse in the gap |
| `linked` (~0.7 s) | resumed; begins on the video's `playing` | gap closes, a spark where the lines meet |
| `docked` (~4 s) | playing | field and lines dissolve; logo moves to the top-right corner at 80% opacity |
| `leaving` (~0.9 s) | playing | corner logo fades |

Lines and dots take the service's brand colour (`PROVIDER_ACCENTS` in
`ProvenanceHandoff.jsx`; white otherwise). Timings are `SCENE_TIMING` in
`useSceneTimeline.js`; the hold is drawn uniformly from `linkMinMs`–`linkMaxMs` once
per title, handed to the Player as the intro's `minHoldMs`, and passed to the scene as
`--ph-link-ms`, so the lines take exactly that long. The Player holds longer if the
video is still loading.

**The connecting motion** is new for every play (`linkCurve.js`, `makeLinkPlan`): one
or two stops where the whole link waits (both lines freeze; the dots slow to a
2.4 s pulse and dim, then pick up with a hop as it moves again), uneven bursts between
them, and often a hang on one side only (the sides never freeze or move off on the
same frame). Stops fall between 10% and 86% of the hold and take at most 42% of it;
the lines always arrive at full reach exactly when the hold ends. The plan is injected
as per-play `@keyframes` for each line; the stops are timers for the dots
(`provenance-handoff--stalled`, `--resumed`).

**Contrast.** When the logo preloads, the player measures it (`logoContrast.js`): the
mean relative luminance of its opaque pixels against the field, as a WCAG ratio. Under
3:1 (the large-graphics threshold) the logo rides on a light rounded plate, in the centre
and docked. Disney+'s navy wordmark (about 2.5:1) gets one; Netflix and Kanopy red do
not. A newly added dark logo gets a plate without any change.

**The Player gates it.** The scene is the Media app's *intro* in the shared Player's
intro slot (`useVideoIntro` in the playback presentation contract): `useProvenanceIntro`
reports `pending` while the provider is looked up, `ready` once the logo has loaded,
`none` otherwise (including a lookup that failed or did not answer within 8 s,
`PROVENANCE_FETCH_TIMEOUT_MS`), plus `minHoldMs` and a `render(stage)` callback. A
title whose id is not a numeric Plex rating key gets no intro at all (the lookup
could never ask). The Player's `useIntroGate` owns all timing (see "Presentation
contract and the intro slot" in `__docs/reference/content/content-playback.md`):

- The scene starts from the play request, before the Player has fetched the
  title's play info. The provenance answer carries `startSec`: where a play of the
  title would start, read by the playback capability's read-only
  `peekStartPosition` (same resume rule as `/play`, no bookmark or sync write). When
  it is inside 5 s the scene covers the play-info fetch too; when it is a resume or
  unknown, the scene waits for the play info as before. The hold counts from when
  the scene first appeared.
- While `pending`, the Player holds its spinner back for up to 1.5 s
  (`INTRO_WAIT_COVER_MS`) so the scene is not preceded by a spinner flash; past that
  the spinner shows normally. If the answer arrives before the film has rolled 1 s,
  the scene still appears (the first frame is paused and held); after that the gate
  lets go (`late`).
- Once `ready`, it covers the spinner, holds the first frame until `minHoldMs` is
  over, resumes, and moves to `playing` (if resuming does not report `playing`
  within 2.5 s it moves on anyway).
- A video that has not produced a frame 20 s after the hold was due
  (`INTRO_COVER_CEILING_MS`) ends the intro, so a broken stream is never hidden
  behind the scene.
- It shows nothing on a resume (start past 5 s, including the resume target a
  remount carries) or on a recovery remount, **except** a resume after a long
  absence: the answer's `resumeShowsScene` (last played more than
  `scene.resume_after_hours`, default 6, ago) becomes the intro's `resumeOk`, and the
  scene covers the resume point instead.
- **A restart replays it.** Once the scene is done (or was off for a resume), a seek
  from 10 s or later back to within 2 s of the top replays the scene as a fresh
  start: the video is held at the top for a new hold (`intro.replay`).
- The scene is drawn in the Player's intro layer, below its loading layer: the
  source-healing wait, its Skip and the exhausted/held recovery UI always paint over
  the scene.

`useSceneTimeline` maps the stage to the scene's phase: `covering`/`holding` draw
`linking`; entering `playing` runs `linked` → `docked` → `leaving`. The
content-filter bumper ("Edited for content") is held while the intro is up and, from
the first `playing` render, until the lines have met and the field has dissolved, so
on a filtered title it follows the scene instead of covering it.

`?provenance=0` on the page URL turns it off for that load.

## Choosing the service

The rules live in `provenance.yml` (`domain/provenance/rules.mjs` reads them). Three
stages, each read top to bottom, first match wins:

1. **overrides** beat the availability service. A match spends no lookup.
   Household: content filter active (certified for the `family` profile, the
   player's own default-on test) → VidAngel; collection Living Scriptures → Living
   Scriptures; studio MagellanTV, CuriosityStream, BYUtv → their own service.
2. **priority** groups rank the availability service's offers. Only subscription
   (`sub`) and free (`free`) listings count; rent and buy never do. Household:
   subscribed (Prime Video, Peacock, YouTube TV) > library (Hoopla, Kanopy) > free
   (Tubi, Pluto TV, Roku Channel, Crackle, YouTube) > any other service with a logo.
   A service sold as a channel inside another app counts as that app: "Paramount+
   (Via Amazon Prime)" and "AMC+ Amazon Channel" are Prime Video, "HBO (Via Hulu)"
   is Hulu, "Max Roku Channel" is the Roku Channel, "AMC Plus Apple TV Channel" is
   Apple TV (`providerIdFor`, applied to stored records too).
3. **fallbacks** when no offer qualifies. Household: movies before 1950 → Internet
   Archive; movies under 40 minutes → YouTube; the documentary libraries →
   CuriosityStream; then by studio or network (Universal/NBC → Peacock, Paramount/CBS
   → Paramount+, Warner/HBO → Max, Disney/Fox/Marvel → Disney+, MGM/Amazon → Prime
   Video, Columbia/Sony → Netflix, Angel Studios → Living Scriptures, ...); then
   anything else → Peacock or Prime Video.

A rule's `when` holds when all of its keys do; a list matches any item, case
insensitive:

| Key | Matches |
|---|---|
| `kind` | `movie`, `show` (an episode answers as its show) |
| `library` | the library's name |
| `studio` | whole words in the studio (or network) name: `MGM` matches "Metro-Goldwyn-Mayer (MGM)", `AMC` does not match "DreamCrew" |
| `collection`, `label` | one of the title's collections or labels |
| `content_filter: active` | the content filter turns on for it by default |
| `year_before`, `shorter_than_min`, `longer_than_min` | year, running time in minutes (unknown never matches) |

`when: always` (or no `when`) matches anything; an unknown key never matches, so a
typo cannot catch every title. A rule's `provider` may be a list: one is picked per
title, stably (a hash of the title's key), so a title always lands on the same one. A
rule whose provider has no logo in `data/content/providers/` is skipped, and the
next rule is tried. The facts (studio, collections, labels, library, year, length)
come from the media-server adapter on every play; nothing in the rules names the
media server.

The answer's `source` is `override`, `availability` or `fallback`; `tier` is the
priority group for an availability answer; `rule` names the rule that matched.

## Files

| What | Where |
|---|---|
| Household policy (scope, rules, refresh, reserve, scene) | `data/household/media/provenance.yml` (registry key `provenance`) |
| Availability cache (machine-written) | `media/content-providers/availability.yml` |
| Logos | `data/content/providers/<id>.svg` or `.png`; `<id>.white.svg` for a black logo on the dark field; `sources.yml` records where each came from |
| API key | system auth `watchmode.yml` → `api_key` |

```yaml
# data/household/media/provenance.yml (abridged)
enabled: true
kinds: [movie, show]
libraries: [Movies, Documentaries, TV Shows, Documentary Series]
lookup: { region: US, refresh_days: 30, quota_reserve: 100 }
scene: { resume_after_hours: 6 }
overrides:
  - { name: content filter, provider: vidangel, when: { content_filter: active } }
  - { name: living scriptures, provider: living-scriptures, when: { collection: [Living Scriptures] } }
priority:
  - { name: subscribed, providers: [prime-video, peacock, youtube-tv] }
  - { name: library, providers: [hoopla, kanopy] }
  - { name: free, providers: [tubi, pluto-tv, roku-channel, crackle, youtube] }
  - { name: other, providers: any }
fallbacks:
  - { name: early film, provider: archive-org, when: { kind: [movie], year_before: 1950 } }
  - { name: universal, provider: peacock, when: { studio: [Universal, NBC] } }
  - { name: anything else, provider: [peacock, prime-video], when: always }
```

An older file with `providers: { free: [...], subscribed: [...] }` and no `priority`
still works: it reads as free > subscribed > any.

Provider ids: `netflix`, `prime-video`, `hulu`, `disney-plus`, `peacock`, `hbo-max`,
`paramount-plus`, `apple-tv`, `tubi`, `pluto-tv`, `hoopla`, `kanopy`, `roku-channel`,
`amc-plus`, `philo`, `directv`, `youtube`, `youtube-tv`, `vimeo`, `dailymotion`,
`crackle`, `curiosity-stream`, `magellan-tv`, `archive-org`, `byutv`, `vidangel`,
`living-scriptures`. A few spellings map to these in `providerIdFor`
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
- An override that matches spends no lookup at all.
- A kind outside `kinds` (a music track; a show when only movies are on) spends no
  lookup and records nothing. The Player asks for every Plex title it starts,
  music included, so this is what keeps the allowance for films.
- Plex `Guid` entries give the id: IMDb when present, else a typed TMDB id
  (`movie-603`, `tv-1396`). No external id: recorded with `note: no external id`,
  no lookup spent.
- A record is reused for `refresh_days`, including "found nowhere" (`offers: []`).
- Watchmode's `X-Account-Quota-Used` header is stored as `usage`; lookups stop at
  `quota - quota_reserve` for the rest of the month (a stale record is still served).
- A failed lookup serves the stale record if there is one, else nothing.
- Concurrent plays of one title share one lookup.

An uncached lookup took 160 to 460 ms in testing; a cached answer a few
milliseconds. The film never waits for one: the Player holds its spinner back for up
to 1.5 s and the scene still appears if the answer is in before the film has rolled
1 s; a slower first answer plays plain, and the next play has it.

## API

`/api/v1/provenance`:

- `GET /:ratingKey` (bare or `plex:`-prefixed) → `{ provenance: { ratingKey, provider, name, tier, source, rule, offerType, checkedAt, logo } | null, startSec: number | null, resumeShowsScene: boolean }`.
  `startSec` and `resumeShowsScene` (`DescribePlayStart`) are read only when a
  provider was found; unknown when the read failed (warn `provenance.start.read-failed`).
- `GET /logo/:provider[?variant=white]` → the logo (white variant preferred when
  asked, else the base logo); cached for a day

## Code

| Layer | Path (under `__app_modules/media/media/`) |
|---|---|
| Domain rules | `server/domain/provenance/provenance.mjs` (offers, ids, freshness), `rules.mjs` (the household's rules) |
| Use cases | `server/application/provenance/GetTitleProvenance.mjs`, `DescribePlayStart.mjs`, ports in `ports/` |
| Adapters | `server/adapters/provenance/` (Watchmode, Plex identity, YAML store, logo catalog) |
| Route + wiring | `server/api/provenance.mjs`, `server/composition/provenance.mjs` |
| Player | `browser/provenance/` (`useProvenance`, `useProvenanceIntro`, `useSceneTimeline`, `ProvenanceHandoff`, `linkCurve.js`, `playbackPresentation.jsx`); installed by `browser/playback.mjs` as the Player's `useVideoIntro` |
| Content filter status | `server/composition/content-filter.mjs` returns `filterStatus.isActive` alongside its router |

The Player hides its own plain spinner while the intro covers (never a state with
something to say), so Media's loading-suppression store is only the content filter's
skip card.

## Logs

Backend (`context.module: provenance`): `provenance.lookup.done` (providers found,
`quotaUsed`), `provenance.lookup.failed`, `provenance.lookup.quota-reserved`,
`provenance.lookup.no-external-id`, `provenance.content-filter.read-failed`,
`provenance.disabled` (no key or no Plex at boot).

Frontend (`component: provenance`): `provenance.ready`, `provenance.none`,
`provenance.fetch.failed` (`error: 'timeout'` after 8 s), `provenance.logo.failed`.
The gate itself logs from the Player (`component: intro-gate`): `intro.covering`,
`intro.holding` (debug), `intro.playing`, `intro.replay` (`from`, `to`),
`intro.off` (debug; warn for `cover-timeout`), `intro.resume-refused`.
