# Daylight on Android and Android Auto

This guide describes the build 77 phone candidate tested on the USB phone and
its handoffs to Android Home, Apex, the native media session, and Android Auto.
The candidate requires the matching Android source and backend audio catalog
changes. Check the build number before following the instructions. See the [phone acceptance runbook](../../__docs/runbooks/android/phone-acceptance.md)
for first install, permissions, cold starts, and device qualification.

## Set up on the phone, use from Home

The Daylight app icon opens setup. Use **Services** to place shortcuts for Media,
Call, Health, Home, or Lifelog. Each shortcut opens its own full-screen view. If
a service needs sign-in, complete it in that view. Back returns to the launcher
from the service root. Apex also exposes Daylight actions in its shortcut picker,
including for gestures. The launcher controls the small Daylight badge on
shortcut icons.

Use **Quick capture** to place Journal voice and text, Meal voice and text, Meal
photo, Meal barcode, and Capture status. Voice and photo require an explicit
send or acceptance. Allow microphone or camera access when Android asks. Meal
barcode uses the Health scanner. Capture status is the place to check receipts
and recover failed submissions. Call requests camera and microphone access when
it opens. The startup text sits on a dark preview until video starts. Use
**Exit** to close the Call view and release capture.

## Playlist widgets on Apex

1. In Daylight, open **Play on demand → Playlists** and choose a cover. The server
   supplies the configured catalogs, including Plex, Programs, Watchlists, and
   Custom lists. Choose whether to shuffle and select **Stage playlist**.
2. Open **Staged**, select the playlist, and choose **Add widget**. Confirm the
   placement if the launcher offers it. In Apex, you can also open Home's
   widget picker and place **Daylight playlist** in an available 1×1 cell.
3. In the widget chooser, use **Search staged playlists**, **Recently placed**,
   or the alphabetical **All staged playlists** list. Recently placed shows up
   to four staged playlists. The list recycles rows and loads covers as rows
   bind. Canceling the chooser cancels that placement.

Staging saves a choice in Daylight. Each home-screen widget gets its own
assignment through Android. Staging many playlists does not add launcher icons.
Unstaging removes the playlist from the picker and Drive, while existing widget
assignments keep their own content ID. Remove an existing widget through Apex.

Tap to play or pause in place. The idle card shows playlist artwork. During
playback, available track artwork replaces it and three bars animate in the
badge. The paused card keeps the playhead. When duration is known the card shows
a thin progress line, and it adds elapsed time, total time, and track count when
space permits. Android's disabled-animation setting selects a static pause icon.

## Drive, Recent, and Library

Daylight supplies the tab labels and order through `media.roots` in
[the phone profile](devices/phone.yml). Android Auto draws the tabs. The layout
starts at **Drive**. **Recent** shows recent playable audio and labels partial
progress when available. **Library** leads with configured listening categories
and has **All playlists** for browsing by collection.

- **Drive staples** are chosen separately. In **Staged → Playback options**,
  enable **Show on Drive** for a playlist. It becomes playable directly from
  Drive. Keeping a playlist staged is enough to place it as a phone widget.
- **Driving Radio** appears above the staples when there is a playlist for
  today. On the phone, open **Driving Radio** and choose a staged **Default**
  and any weekday overrides. The day rule takes priority, with the default as
  fallback if the day's queue is unavailable. The row shows the configured pick
  for today. Shuffle follows the staged playlist setting.
- With an Android Auto controller connected, natural queue completion can load
  Driving Radio. Pause, Stop, queue replacement, disconnect, and a change to
  the radio selection invalidate an in-flight handoff. An Android Auto playback
  resumption request with no item can also resolve Driving Radio. Actual
  behavior of a vehicle's generic Play button depends on which media command
  its host sends.
- Android Auto search accepts playlist names. A unique exact staged-title
  match uses the staged playlist and its shuffle setting. Spaces and punctuation
  in names such as `FM 100` are normalized. Gemini can launch Daylight without
  passing a media query, so an app launch alone does not establish that
  play-from-search ran.

## Queue and configuration contracts

The household media config at `data/household/media/config.yml` controls
`play_on_demand.sources` and `play_on_demand.browse`. Each entry has a catalog
or content `id` and may supply a display `title`. Browse destinations need a
title. Registered adapters expose their audio catalogs. The app consumes those
catalogs through `/api/v1/queue/catalog/audio-sources`,
`/api/v1/queue/catalog/audio-lists`, and `/api/v1/queue/catalog/audio-browse`.

Native queue requests carry `profile=audio-only`. The server resolves nested
lists and schedule rules, keeps playable audio, and projects supported video
audio renditions. Images and interactive entries are filtered out of audio
queues. Local file and Plex video renditions can stream extracted audio through
a provider-owned path marked `stream=audio`. The session can use the source
duration for progress. These continuous renditions currently have no seek index.

Playlist widget starts, Drive staples, and Driving Radio pass saved shuffle
preferences to the server. The player preserves the returned order. Station
sequence sidecars under `data/content/surround/radio/` can pin an opening ID
and insert additional IDs between songs. FM100 uses a pinned first track and
station IDs every three to five songs.

Device-local choices live in `daylight_buttons`. Assignment and placement time
are saved together when a widget is confirmed. Older assignments have no
timestamps, so widget ID order approximates their recency until the user
places a widget again. The owning code is in [widgets](capabilities/widgets),
[media-service](capabilities/media-service), and
`DrivingRadioSettings` in [shell-kit](shell-kit) on the candidate branch.

## Verification and remaining checks

On the USB test phone, Apex opened the widget chooser, showed Recently placed,
and filtered six staged playlists to FM100. Genesis played directly from its
home-screen widget. Kids Videos streamed audio and its progress line advanced.
On the Android Auto Desktop Head Unit, a Daylight watchlist played from Library,
FM100 began with the station ID, and enabling **Show on Drive** put FM100 on
Drive. The temporary staple setting used for that check was restored.

Before calling a release qualified, check the actual vehicle, the exact Gemini
phrase and resulting media command, a natural-end Driving Radio handoff and
its cancellation by Pause or Stop, and the picker with a large staged list.
The desktop check and six-item picker check cover different parts of that
acceptance.
