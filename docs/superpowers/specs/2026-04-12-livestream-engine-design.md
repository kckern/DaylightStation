# LiveStream Engine — Design Spec

**Date:** 2026-04-12
**Status:** Approved

## Overview

A continuous audio streaming framework for DaylightStation. Serves never-ending HTTP audio streams (Icecast-style `audio/aac`) that external devices (Yoto player, etc.) connect to as internet radio stations. Supports real-time control: queue management, force-play interrupts, and scriptable programs (YAML state machines + JS modules) with interactive branching via Zigbee button input.

## Goals

- Serve named audio channels as persistent HTTP streams (chunked AAC, no Content-Length)
- Queue-based playback with force-play override
- Scriptable programs: declarative YAML DSL for simple flows, JS modules for dynamic/generative content
- Interactive branching (A/B/C/D input) for choose-your-own-adventure and similar patterns
- DJ board frontend for channel management, soundboard, and live queue control
- Pre-generated TTS pipeline — all audio resolved to files before reaching the stream engine

## Non-Goals

- Real-time audio mixing/layering (files come pre-mixed)
- Client-side playback (the Yoto is the client; the frontend is control-only)
- Persistent program state across server restarts (programs are ephemeral sessions)

---

## Architecture

### Core Stream Pipeline

Per-channel, two FFmpeg processes handle the audio pipeline:

```
Track1.mp3 → [Decoder1] → PCM ─┐
                                 ├──▶ [Encoder stdin] → AAC → Broadcast Buffer → HTTP clients
Track2.ogg → [Decoder2] → PCM ─┘
                                 
(queue empty) → Silence/Ambient PCM ─┘
```

**Decoder** (short-lived, one per track): Converts any input format to raw PCM.
```
ffmpeg -i input.mp3 -f s16le -ar 44100 -ac 2 pipe:1
```

**Encoder** (long-lived, one per channel lifetime): Reads continuous PCM from stdin, outputs AAC in ADTS framing.
```
ffmpeg -f s16le -ar 44100 -ac 2 -i pipe:0 -c:a aac -b:a 96k -f adts pipe:1
```

**Broadcast Buffer**: Encoder stdout piped to a PassThrough stream. Each HTTP client added as a listener. Rolling ~30s buffer so new clients start with audio immediately. Client disconnect removes the listener — no impact on the pipeline.

**Silence generation** (when queue is empty, ambient is `silence`):
```javascript
const silenceFrame = Buffer.alloc(44100 * 2 * 2); // 1 second of PCM silence
// Written to encoder stdin on a timer
```

### Component Model

```
┌─────────────────────────────────────────────────┐
│                 ChannelManager                   │
│  channels: Map<name, StreamChannel>              │
│  create(name, config) / destroy(name)            │
├─────────────────────────────────────────────────┤
│              StreamChannel "yoto"                 │
│                                                   │
│  ┌──────────┐    ┌────────┐    ┌──────────────┐ │
│  │  Source   │───▶│ FFmpeg │───▶│  Broadcast   │ │
│  │  Feeder   │    │ (AAC)  │    │  Buffer      │ │
│  └──────────┘    └────────┘    └──────┬───────┘ │
│       ▲                               │          │
│       │                          ┌────▼────┐     │
│  Queue / Ambient                 │ HTTP    │     │
│  / Force-play                    │ Clients │     │
│                                  └─────────┘     │
└─────────────────────────────────────────────────┘
```

**SourceFeeder** owns a writable reference to the encoder's stdin:
- Spawns a decoder for the current track, pipes decoder stdout → encoder stdin
- When decoder ends (track finished), pulls next from queue
- If queue empty, writes silence or loops ambient file decoder
- On **force-play**: kills current decoder, immediately spawns new one for the forced file
- On **skip**: same as force-play but pulls from queue

---

## Channel Configuration

Channel definitions in `data/household/config/livestream.yml`:

```yaml
channels:
  yoto:
    format: aac
    bitrate: 96
    ambient: silence            # silence | white-noise | file:ambient/lullaby.mp3
    program: yoto-bedtime       # optional — references a program definition
    soundboard:
      - label: Lullaby
        file: sounds/lullaby.mp3
      - label: "Time for bed"
        tts: "Okay everyone, it's time for bed"
      - label: Rain
        file: ambient/rain.mp3
        force: true             # always force-play, don't queue

  office:
    format: aac
    bitrate: 128
    ambient: file:ambient/lo-fi.mp3
    program: null               # pure DJ board, no automation

programs:
  yoto-bedtime:
    type: yaml
    path: programs/yoto-bedtime.yml

  story-adventure:
    type: yaml
    path: programs/story-adventure.yml

  morning-radio:
    type: js
    path: programs/morning-radio.mjs
```

---

## Programs

### YAML State Machine DSL

Declarative flows for radio schedules, CYOA stories, routine sequences:

```yaml
name: Dragon Cave Adventure
start: intro

states:
  intro:
    play: stories/dragon/intro.mp3
    then:
      prompt: stories/dragon/choose-path.mp3
      wait_for_input:
        timeout: 30
        default: a
      transitions:
        a: cave
        b: forest
        c: mountain

  cave:
    play: stories/dragon/cave-enter.mp3
    then:
      queue:
        - stories/dragon/cave-ambience.mp3
        - stories/dragon/cave-discovery.mp3
      next: cave-choice

  cave-choice:
    play: stories/dragon/cave-choose.mp3
    then:
      wait_for_input:
        timeout: 30
        default: a
      transitions:
        a: fight-dragon
        b: sneak-past

  ending-victory:
    play: stories/dragon/victory.mp3
    then: stop    # ends program, channel falls to ambient
```

**Supported state actions:**
- `play: <file|tts-spec>` — play a single item
- `queue: [...]` — append list to queue, await all complete
- `then.next: <state>` — immediate state transition
- `then.wait_for_input` — pause for button input with timeout + default
- `then.transitions: { a: state, b: state, ... }` — map input to next state
- `then: stop` — end program
- `condition:` — branch without user input (time-of-day, random, etc.)
- `random_pick:` — weighted random state selection

### JS Modules

For dynamic/generative content (LLM, TTS, API-driven):

```javascript
// programs/morning-radio.mjs
export default async function({ channel, tts, clock, api, input }) {
  const weather = await api.fetch('/api/v1/weather/current');
  await tts.play(`Good morning! It's ${clock.format('h:mm a')}. ${weather.summary}`);

  await channel.queue('jingles/morning-theme.mp3');

  const news = await api.fetch('/api/v1/feed/headlines?limit=3');
  for (const item of news) {
    await tts.play(item.title);
    await channel.pause(1000);
  }

  await channel.queue('music/morning-playlist.mp3');
}
```

**Context object:**
- `channel.play(file)` — play, resolves when track finishes
- `channel.queue(files)` — append and await completion
- `channel.pause(ms)` — insert silence gap
- `tts.play(text)` — pre-generate + play, resolves when done
- `tts.prepare(text)` — pre-generate only, returns handle for later play
- `input.wait({ timeout, default, prompt })` — block for button input
- `clock` — time utilities
- `api.fetch(path)` — internal API access

If a JS program throws or returns, the channel falls back to ambient. Force-play interrupts cause awaiting promises to reject with an interrupt error the runner handles gracefully.

### Program Runner

**ProgramRunner** executes both program types:
- YAML: loads state graph, tracks `currentState`, evaluates transitions
- JS: imports module, calls async function with context, awaits completion

**Pre-resolution:** On each state transition (YAML) or ahead of `play()` calls (JS), the runner pre-resolves upcoming TTS and validates file paths so the SourceFeeder never blocks.

Program state is held in memory only — no disk persistence. Server restart returns channel to ambient.

---

## TTS Pipeline

All TTS resolves to files *before* reaching the SourceFeeder. The stream engine only sees file paths.

```
Request (text) → IAudioAssetResolver → Cache → File Path → Queue
                                                             │
                                               SourceFeeder only sees files
```

### IAudioAssetResolver

Domain interface — anything that can become a playable file:
```javascript
resolve(spec) → { path: '/tmp/livestream/tts/abc123.mp3', duration: 4.2 }
```

Spec is abstract: `{ type: 'tts', text, voice, model }`, `{ type: 'file', path }`, or future types.

### TTS Resolver

Wraps existing TTSAdapter:
- Generates audio file → writes to cache directory (`/tmp/livestream/tts/`)
- Cache key = hash of (text + voice + model) — same input doesn't regenerate
- Returns file path + duration once ready

### Pre-generation Strategy

| Context | Strategy |
|---------|----------|
| **YAML programs** | On program start, pre-resolve all TTS specs reachable within 2-3 transitions of current state. Re-scan on each state transition. |
| **JS programs** | `tts.prepare(text)` pre-generates and returns a handle. `tts.play(text)` auto-prepares if not cached, but authors should `prepare()` early. |
| **Queue submissions** | API accepts mixed specs (files + TTS). TTS specs resolve before entering queue. POST returns only after all items are resolved. |
| **Soundboard buttons** | TTS buttons pre-generate on channel start and on config change. Cached and instant. |

### Cache Management

- TTL-based cleanup — files older than 24h purged
- LRU eviction if cache exceeds size limit
- Soundboard TTS entries pinned (no eviction)

---

## API Layer

New router at `/api/v1/livestream/`.

### Stream Endpoint

```
GET /api/v1/livestream/:channel/listen
```
Returns `audio/aac`, chunked transfer encoding, no Content-Length. ICY metadata headers for track info. This is what the Yoto connects to.

### Channel CRUD

```
GET    /api/v1/livestream/channels              → list all channels + status
POST   /api/v1/livestream/channels              → create channel { name, config }
GET    /api/v1/livestream/:channel              → channel status (playing, queue, program state)
PUT    /api/v1/livestream/:channel              → update channel config
DELETE /api/v1/livestream/:channel              → stop & destroy channel
```

### Playback Control

```
POST   /api/v1/livestream/:channel/queue        → append to queue { files: [...] }
DELETE /api/v1/livestream/:channel/queue/:index  → remove from queue
POST   /api/v1/livestream/:channel/skip         → skip current track
POST   /api/v1/livestream/:channel/force        → force-play immediately { file: "..." }
POST   /api/v1/livestream/:channel/stop         → stop playback, fall to ambient
```

### Program Control

```
POST   /api/v1/livestream/:channel/program/start   → start a program { program: "story-adventure" }
POST   /api/v1/livestream/:channel/program/stop    → stop current program
POST   /api/v1/livestream/:channel/input/:choice   → send A/B/C/D input (Zigbee button target)
```

### WebSocket Integration

Channel broadcasts status changes on topic `livestream:{channel}`:
- Track changed, queue updated
- Waiting for input (with available choices)
- Program state transitions

---

## DDD Layer Placement

| Layer | Path | Files | Purpose |
|-------|------|-------|---------|
| **1_adapters** | `backend/src/1_adapters/livestream/` | `FFmpegStreamAdapter.mjs` | FFmpeg process lifecycle, PCM piping, broadcast buffer |
| **1_adapters** | `backend/src/1_adapters/livestream/` | `manifest.mjs` | Adapter registry manifest (capability: `livestream`) |
| **2_domains** | `backend/src/2_domains/livestream/` | `StreamChannel.mjs` | Channel entity — queue, state, ambient config |
| **2_domains** | `backend/src/2_domains/livestream/` | `ProgramRunner.mjs` | Executes YAML state machines and JS program modules |
| **2_domains** | `backend/src/2_domains/livestream/` | `SourceFeeder.mjs` | Orchestrates what gets fed to FFmpeg — queue, ambient, force-play |
| **2_domains** | `backend/src/2_domains/livestream/` | `IAudioAssetResolver.mjs` | Domain interface for resolving specs to playable files |
| **3_applications** | `backend/src/3_applications/livestream/` | `ChannelManager.mjs` | Application service — CRUD, routes commands, persists config |
| **4_api** | `backend/src/4_api/v1/routers/` | `livestream.mjs` | Express router — all endpoints above |

### Config Files (data volume)

```
data/household/config/livestream.yml        → channel definitions
data/household/apps/livestream/programs/    → YAML and JS program files
```

### Frontend

```
frontend/src/modules/Media/LiveStream/
  ChannelList.jsx         → CRUD channel cards
  DJBoard.jsx             → soundboard grid + queue view per channel
  ProgramStatus.jsx       → current program state, waiting-for-input indicator
```

Sub-route in MediaApp at `/media/livestream`.

---

## Frontend: DJ Board

### Channel List (`/media/livestream`)

Cards for each channel showing name, status (playing/idle/waiting for input), current track, listener count. Create new channel button opens config form.

### DJ Board (`/media/livestream/:channel`)

Split view — soundboard left, queue right:

```
┌─────────────────────────┬──────────────────────┐
│     Soundboard          │      Queue            │
│                         │                       │
│  ┌─────┐ ┌─────┐       │  > Now: intro.mp3     │
│  │Btn1 │ │Btn2 │       │    02:31 / 04:15      │
│  └─────┘ └─────┘       │                       │
│  ┌─────┐ ┌─────┐       │  2. chapter-1.mp3     │
│  │Btn3 │ │Btn4 │       │  3. chapter-2.mp3     │
│  └─────┘ └─────┘       │                       │
│                         │  [+ Add files]        │
│  ┌─────────────────┐   │                       │
│  │ Stop  │  Skip   │   ├──────────────────────┤
│  └─────────────────┘   │  Program: story-adv   │
│                         │  State: cave-choice   │
│  Programs v             │  Waiting for input    │
│  [Start program...]     │  [A] [B] [C] [D]     │
│                         │                       │
└─────────────────────────┴──────────────────────┘
```

- **Soundboard:** Configurable button grid per channel. Tap = queue, long-press = force-play. Transport controls (stop, skip). Program launcher.
- **Queue panel:** Now-playing with progress, reorderable queue via drag, add files button.
- **Program status:** Shows when a program is running — current state, and A/B/C/D input buttons when waiting.
- **Real-time updates:** WebSocket subscription to `livestream:{channel}`.

---

## Integration Points

### Zigbee Buttons (via HA)

Same pattern as kitchen four-button panel. HA automation fires HTTP POST:
```
POST /api/v1/livestream/yoto/input/a
```

### Existing TTS Adapter

The TTS resolver wraps `TTSAdapter` from `backend/src/1_adapters/hardware/tts/`. No changes needed to the existing adapter — the resolver layer handles caching and pre-generation.

### WebSocket EventBus

Status broadcasts on `livestream:{channel}` topic using existing `WebSocketEventBus`. No new WebSocket infrastructure needed.

### Adapter Registry

New `manifest.mjs` registers with `AdapterRegistry` (capability: `livestream`). Channel config loaded via `ConfigService` from `livestream.yml`.

---

## Path Resolution

All file references in channel config, programs, and API calls resolve relative to the media volume root (same as existing stream/proxy routers). The `file:` prefix in ambient config (e.g., `file:ambient/lo-fi.mp3`) is stripped and resolved against the media base path. Path traversal prevention applies (same as existing proxy router).
