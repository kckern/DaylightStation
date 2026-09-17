# Android Auto Support

> The household media library on the car's head unit, starting with audio.

**Last Updated:** 2026-09-17
**Status:** Direction agreed, not scheduled

**Related:** [Android Consolidation and Kiosk Ownership](2026-09-17-android-consolidation-and-kiosk-ownership.md)

---

## Scope

Three capabilities, in order. Only the first is committed as a direction.

| Phase | Category | Distribution |
|---|---|---|
| **1. Media (audio)** | Browse and play the household library | Sideloadable — no Play listing required |
| **2. Messaging notifications** | Bot prompts read aloud, answered by voice | Sideloadable |
| **3. IoT templates** | Household control from the head unit | **Play-only** |

---

## The distribution rule that shapes everything

Android Auto's developer menu (Version tapped ten times → Developer settings →
**Unknown sources**) permits sideloaded apps — but **only for media, messaging
notifications, and parked apps. It does not apply to apps built with the
Android for Cars App Library.**

So media and messaging can ship as a direct APK and work fully. Anything
template-based — IoT, POI, weather, navigation — requires a Play listing, which
means it rides on the phone companion described in the consolidation roadmap,
not on a sideloaded build.

Android Auto apps execute **on the phone**. The head unit is a display and
input surface. Nothing runs in the vehicle.

---

## Phase 1: Media

### Transport is already solved

Plexamp streams from a home server over cellular during normal driving today.
That is sufficient evidence that a reachable endpoint, audio bitrates and tower
handoffs are all fine in practice. **No VPN work, no sync engine, no offline
store is required for a first version.**

Point the app at our own backend rather than at Plex directly.
`PlexProxyAdapter` already injects the token and handles retries, so the app
needs one base URL and one credential — and the same app serves audiobooks and
anything else added later.

Keep the app transport-agnostic: base URL plus credential, working identically
over LAN at home, a tunnel for those who run one, or the hosted endpoint from
[Business Model](../marketing/business-model.md). An app that only works for
people who run a VPN cannot ship to anyone else.

### Implementation surface

**Service.** Media3 `MediaLibraryService` with a `MediaLibrarySession`.
Register **both** intent filters — `androidx.media3.session.MediaLibraryService`
and the legacy `android.media.browse.MediaBrowserService` — because Android
Auto still discovers apps through the legacy action. Media3 bridges it.

**Manifest.** `<meta-data android:name="com.google.android.gms.car.application"
android:resource="@xml/automotive_app_desc"/>`, whose XML declares
`<uses name="media"/>`.

**Browse tree.** `MediaLibrarySession.Callback` supplies `onGetLibraryRoot`,
`onGetChildren`, `onGetItem`, `onSearch`, `onGetSearchResult`. Items are
`MediaItem`s whose `MediaMetadata` sets browsable/playable, title, subtitle,
`artworkUri` and `mediaType`. Root-level browsable items become the top tabs.
Keep the hierarchy shallow — the platform truncates long lists and limits depth
for distraction reasons, and exact caps vary by head unit, so design for short
lists three or four levels deep rather than against a specific number.

**Grid versus list.** Content style hints as extras on the root and on items
(`MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE` / `..._PLAYABLE`). Grid
for cover art, list for tracks and chapters.

**Transport controls.** Play, pause, skip and seek are rendered by the head
unit from the session's available commands. Extras such as shuffle or a
30-second jump go in `setCustomLayout()` as `CommandButton`s — a couple at
most.

**Voice.** Assistant's "play X on <app>" arrives as search-initiated playback.
Implement fuzzy matching across titles, artists, albums and playlists, and
answer quickly. Pause, next and previous need no work — the session handles
them.

**Errors.** Set an error playback state with a resolution intent so an
unreachable server shows a message and a button on the head unit instead of an
empty library.

**Cache the browse tree locally** so the first screen is populated immediately
rather than after a round trip.

**Testing.** Desktop Head Unit over ADB, plus the Media Controller Test app.

### Where the actual work is

Not networking. The build is:

1. **Browse tree design** — what the top tabs are, how levels nest, grid or
   list per level
2. **Voice search quality** — fuzzy matching good enough that "play <thing>"
   works on the first try
3. **Metadata and artwork** on the now-playing screen

### Known issue to check before pinning a version

Media3 1.7.1 has a reported tight create/destroy loop when Android Auto binds
to `MediaLibraryService` with no playback in progress
([androidx/media#3158](https://github.com/androidx/media/issues/3158)).

Constant names move between Media3 releases. Verify against current
documentation at build time rather than against this page.

---

## Phase 2: Messaging notifications

Notifications using `MessagingStyle` with a `RemoteInput` reply action are read
aloud by Assistant and answered by voice, hands-free.

The household bots map onto this directly: a journaling prompt on the drive
home answered by speaking; a meal log confirmed without touching anything. It
turns the commute into a capture surface using a notification path we largely
have already, and it is in the sideloadable set.

---

## Phase 3: IoT templates

Car App Library templates for household control from the head unit — arriving
home, lights, garage, evening program. A good fit for the platform's premise
and the most demonstrable feature in the category.

Gated on the phone companion being listed on Play, since the sideload exemption
does not cover the Car App Library. Sequenced after that listing exists.

---

## Non-goals

- Android Automotive OS. Different platform, different distribution, no
  overlap with the phone-projected case.
- Video and games. Parked-only categories, and not what a car is for here.
- Navigation. Requires turn-by-turn and has nothing to do with this platform.
- An offline sync engine in version one. Revisit only if real use shows
  streaming failing.

---

## Open questions

1. What are the top tabs? The library spans music, audiobooks, talks,
   readalongs and podcasts, and the tab count on a head unit is small.
2. Does playback reporting write back to watch/listen state, and does that
   survive a dropped connection mid-track?
3. Does this ship inside the phone companion or as a separate sideloaded APK?
   One app is simpler to install; two keeps the Play-listed companion's
   permission set clean.
4. Is a lower-bitrate transcode profile needed for cellular, or does direct
   play hold up as it does for existing clients?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-17 | Initial direction: media first and sideloadable, messaging notifications second, IoT templates gated on a Play listing; transport treated as solved |
