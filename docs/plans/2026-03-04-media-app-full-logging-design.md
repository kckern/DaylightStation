# MediaApp Full Logging Coverage Design

**Date:** 2026-03-04
**Status:** Approved
**Approach:** Inline logging (add events directly in each component/hook)
**Purpose:** UAT testing evidence — session logs must capture everything a user reports

## Problem

MediaApp has `sessionLog: true` enabled and the backend session file transport writes to `media/logs/media/<timestamp>.jsonl`. However, only ~40% of events are actually logged. Critical paths like queue mutations, device state changes, playback state, UI loading, search activity, and content rendering are invisible.

For UAT, we need full evidence: what loaded from URL, what the user searched, what results came back, what they selected, did it play, did thumbnails load, did autoplay work, and any rendering quirks.

## Infrastructure (Already Built)

- Frontend Logger with `sessionLog: true` context flag
- WebSocket transport batches events to backend
- `SessionFileTransport` writes JSONL to `media/logs/{app}/`
- 3-day retention with auto-pruning
- `logger.sampled()` for high-frequency events

No infrastructure changes needed. This is purely about adding log statements.

## Sections

### 1. Queue Mutation Logging (useMediaQueue.js)

**Gap:** All mutation methods (`addItems`, `removeItem`, `reorder`, `setPosition`, `advance`, `setShuffle`, `setRepeat`, `setVolume`, `clear`) have zero logging.

**Events to add:**
- `media-queue.add-items` — success with count, contentIds
- `media-queue.remove-item` — success with contentId, index
- `media-queue.reorder` — success with from/to indices
- `media-queue.set-position` — success with index, contentId
- `media-queue.advance` — success with direction, auto flag, new contentId
- `media-queue.set-shuffle` — value
- `media-queue.set-repeat` — value
- `media-queue.set-volume` — value
- `media-queue.clear` — previous count
- All mutations: error path logging on catch

### 2. UI Activity & User Journey Logging

**Goal:** Full evidence trail of what the user saw, searched, selected, and what happened.

**Search activity (useStreamingSearch.js — 0 events → 5):**
- `search.started` (info) — query text, filter params
- `search.results-received` (info) — source, count of new items, total accumulated
- `search.completed` (info) — total results, sources that responded
- `search.error` (warn) — SSE error
- `search.cancelled` (debug) — superseded by new query

**Content loading & thumbnails (ContentBrowser.jsx — add to existing):**
- `content-browser.mounted` / `content-browser.unmounted` (info)
- `content-browser.config-loaded` (info) — browse categories count, category names
- `content-browser.results-rendered` (info) — count of items rendered, has thumbnails
- `content-browser.item-selected` (info) — contentId, title, format, action (play-now/play-next/add-to-queue)

**URL loading & autoplay (MediaApp.jsx — enhance existing):**
- `media-app.url-parsed` (info) — full URL params: contentId, volume, shuffle, device, action (play/queue)
- `media-app.autoplay-attempt` (info) — contentId, from URL command
- `media-app.autoplay-result` (info) — success/fail, reason if failed

**Mode navigation (MediaApp.jsx):**
- `media-app.mode-change` (info) — from/to mode (browse/player), trigger (user/auto-collapse)

**NowPlaying content rendering:**
- `now-playing.content-rendered` (info) — contentId, format, hasThumbnail, title
- `now-playing.empty-state` (info) — nothing playing shown

### 3. Playback State Logging (MediaAppPlayer.jsx)

**Gap:** No logger exists. No visibility into actual media element behavior.

**Events to add:**
- `media-player.loaded` (info) — new content loaded, contentId, format
- `media-player.play` (info) — playback started
- `media-player.pause` (info) — playback paused
- `media-player.progress` (debug, sampled 5/min) — currentTime, duration, buffered
- `media-player.error` (error) — media element error with code/message
- `media-player.stall` (warn) — stalled/waiting event
- `media-player.ended` (info) — natural end of media
- `media-player.autoplay-blocked` (warn) — browser blocked autoplay

### 4. Device State Logging (DevicePanel, DeviceCard, useDeviceMonitor)

**DevicePanel.jsx** — has logger created but 0 events:
- `device-panel.mounted` / `device-panel.unmounted`
- `device-panel.devices-updated` — count, device names

**DeviceCard.jsx** — only logs errors, not success:
- `device-card.power-toggle` — success with device, newState
- `device-card.volume-change` — success with device, volume

**useDeviceMonitor.js** — minimal:
- `device-monitor.subscribed` — WebSocket subscription active
- `device-monitor.device-online` / `device-monitor.device-offline` — device name, ip
- `device-monitor.cleanup` — subscription teardown

### 5. Component Lifecycle Logging

**MiniPlayer.jsx** (2 events → 5):
- `mini-player.mounted` / `mini-player.unmounted`
- `mini-player.seek` — progress bar interaction

**CastButton.jsx** (0 events → 2):
- Add logger
- `cast-button.mounted`
- `cast-button.cast-initiated` — contentId, targetDevice

**QueueItem.jsx** (0 events → 2):
- `queue-item.play-clicked` — contentId
- `queue-item.remove-clicked` — contentId

**PlayerSwipeContainer.jsx** (3 events → 5):
- `swipe-container.page-changed` — add page name (queue/now-playing/devices)
- `swipe-container.mounted` / `swipe-container.unmounted`

### 6. Hook Lifecycle Logging

**usePlaybackBroadcast.js** (1 event → 3):
- `playback-broadcast.setup` — subscription initialized
- `playback-broadcast.cleanup` — subscription torn down

**useMediaClientId.js** (0 events → 2):
- `media-client-id.generated` — new ID created
- `media-client-id.loaded` — existing ID loaded from localStorage

**useDeviceIdentity.js** (0 events → 2):
- `device-identity.resolved` — identity determined
- `device-identity.fallback` — using fallback identity

**useMediaUrlParams.js** (0 events → 1):
- `media-url-params.parsed` — command type, contentId

### 7. MediaAppContext Logging

**MediaAppContext.jsx** (0 events → 2):
- `media-context.initialized` — provider mounted, initial state
- `media-context.player-ref-set` — player ref attached

## Event Naming Convention

All events use dot-separated names: `{component-or-module}.{action}`.
Prefix with `media-` for hooks/context, use component name for UI components.

## Sampling Strategy

Only `media-player.progress` uses `logger.sampled()` at 5/min. All other events are low-frequency and log normally.

## Total New Events

~50 new log events across 15 files. No new files created.
