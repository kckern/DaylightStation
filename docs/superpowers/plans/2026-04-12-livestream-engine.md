# LiveStream Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a continuous audio streaming framework that serves never-ending HTTP audio streams (Icecast-style AAC), with queue-based playback, force-play interrupts, scriptable programs (YAML + JS), and a DJ board frontend.

**Architecture:** Per-channel FFmpeg pipeline — short-lived decoder per track feeds raw PCM into a long-lived AAC encoder, whose output is broadcast to all connected HTTP clients. A SourceFeeder orchestrates track transitions, queue draining, and ambient fallback. Programs (YAML state machines or JS async functions) drive automated playback with interactive branching via button input.

**Tech Stack:** Node.js, FFmpeg (child_process.spawn), Express, Vitest, React, WebSocket EventBus

**Spec:** `docs/superpowers/specs/2026-04-12-livestream-engine-design.md`

---

## File Structure

### Backend — Domain (`backend/src/2_domains/livestream/`)

| File | Responsibility |
|------|---------------|
| `StreamChannel.mjs` | Channel entity — queue, state, current track, ambient config |
| `SourceFeeder.mjs` | Orchestrates what gets fed to FFmpeg — pulls from queue, handles force-play, ambient fallback |
| `ProgramRunner.mjs` | Executes YAML state machines and JS program modules, manages state transitions and input waiting |
| `IAudioAssetResolver.mjs` | Interface for resolving audio specs (file, TTS) to playable file paths |

### Backend — Adapter (`backend/src/1_adapters/livestream/`)

| File | Responsibility |
|------|---------------|
| `FFmpegStreamAdapter.mjs` | Manages long-lived FFmpeg encoder process, broadcast buffer, client connections |
| `TTSAssetResolver.mjs` | Implements IAudioAssetResolver — wraps TTSAdapter, caches generated files |
| `manifest.mjs` | Adapter registry manifest |

### Backend — Application (`backend/src/3_applications/livestream/`)

| File | Responsibility |
|------|---------------|
| `ChannelManager.mjs` | CRUD channels, routes commands, loads config, persists state |

### Backend — API (`backend/src/4_api/v1/routers/`)

| File | Responsibility |
|------|---------------|
| `livestream.mjs` | Express router — stream endpoint, channel CRUD, playback control, program control, input |

### Frontend (`frontend/src/modules/Media/LiveStream/`)

| File | Responsibility |
|------|---------------|
| `ChannelList.jsx` | Channel cards with status, create/delete |
| `DJBoard.jsx` | Soundboard grid + queue view for a single channel |
| `ProgramStatus.jsx` | Program state display, input buttons |
| `LiveStream.scss` | Styles for all livestream components |

### Tests (`tests/unit/livestream/`)

| File | Tests for |
|------|-----------|
| `StreamChannel.test.mjs` | Queue operations, state transitions, force-play |
| `SourceFeeder.test.mjs` | Track sequencing, ambient fallback, interrupts |
| `ProgramRunner.test.mjs` | YAML state machine execution, input handling, JS program context |
| `FFmpegStreamAdapter.test.mjs` | Process lifecycle, broadcast buffer, client management |
| `ChannelManager.test.mjs` | CRUD, config loading, command routing |
| `TTSAssetResolver.test.mjs` | TTS caching, pre-generation, cache eviction |

### Config

| File | Purpose |
|------|---------|
| `data/household/config/livestream.yml` | Channel definitions (created at runtime via API) |
| `data/household/apps/livestream/programs/` | YAML and JS program files |

---

## Task 1: StreamChannel Domain Entity

**Files:**
- Create: `backend/src/2_domains/livestream/StreamChannel.mjs`
- Create: `tests/unit/livestream/StreamChannel.test.mjs`

The channel entity owns queue state, current track, and channel configuration. Pure domain logic — no I/O.

- [ ] **Step 1: Write failing tests for queue operations**

```javascript
// tests/unit/livestream/StreamChannel.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import { StreamChannel } from '../../../backend/src/2_domains/livestream/StreamChannel.mjs';

describe('StreamChannel', () => {
  let channel;

  beforeEach(() => {
    channel = new StreamChannel({
      name: 'yoto',
      format: 'aac',
      bitrate: 96,
      ambient: 'silence',
    });
  });

  describe('construction', () => {
    it('initializes with name and config', () => {
      expect(channel.name).toBe('yoto');
      expect(channel.format).toBe('aac');
      expect(channel.bitrate).toBe(96);
      expect(channel.ambient).toBe('silence');
      expect(channel.status).toBe('idle');
    });

    it('defaults to aac/96 if not specified', () => {
      const ch = new StreamChannel({ name: 'test' });
      expect(ch.format).toBe('aac');
      expect(ch.bitrate).toBe(96);
      expect(ch.ambient).toBe('silence');
    });
  });

  describe('queue operations', () => {
    it('enqueues files and reports length', () => {
      channel.enqueue('/audio/track1.mp3');
      channel.enqueue('/audio/track2.mp3');
      expect(channel.queueLength).toBe(2);
      expect(channel.queue).toEqual(['/audio/track1.mp3', '/audio/track2.mp3']);
    });

    it('enqueues multiple files at once', () => {
      channel.enqueueAll(['/audio/a.mp3', '/audio/b.mp3', '/audio/c.mp3']);
      expect(channel.queueLength).toBe(3);
    });

    it('dequeues the next track (FIFO)', () => {
      channel.enqueue('/audio/track1.mp3');
      channel.enqueue('/audio/track2.mp3');
      const next = channel.dequeue();
      expect(next).toBe('/audio/track1.mp3');
      expect(channel.queueLength).toBe(1);
    });

    it('returns null when dequeuing empty queue', () => {
      expect(channel.dequeue()).toBeNull();
    });

    it('removes item at index', () => {
      channel.enqueueAll(['/a.mp3', '/b.mp3', '/c.mp3']);
      channel.removeAt(1);
      expect(channel.queue).toEqual(['/a.mp3', '/c.mp3']);
    });

    it('clears the queue', () => {
      channel.enqueueAll(['/a.mp3', '/b.mp3']);
      channel.clearQueue();
      expect(channel.queueLength).toBe(0);
    });
  });

  describe('current track', () => {
    it('tracks the currently playing file', () => {
      channel.setCurrentTrack('/audio/now.mp3');
      expect(channel.currentTrack).toBe('/audio/now.mp3');
      expect(channel.status).toBe('playing');
    });

    it('returns to idle when current track cleared', () => {
      channel.setCurrentTrack('/audio/now.mp3');
      channel.setCurrentTrack(null);
      expect(channel.status).toBe('idle');
    });
  });

  describe('force play', () => {
    it('sets forceTrack and status', () => {
      channel.enqueue('/audio/queued.mp3');
      channel.setCurrentTrack('/audio/playing.mp3');
      channel.forcePlay('/audio/urgent.mp3');
      expect(channel.forceTrack).toBe('/audio/urgent.mp3');
    });

    it('consumeForce returns and clears the forced track', () => {
      channel.forcePlay('/audio/urgent.mp3');
      const forced = channel.consumeForce();
      expect(forced).toBe('/audio/urgent.mp3');
      expect(channel.forceTrack).toBeNull();
    });

    it('consumeForce returns null when nothing forced', () => {
      expect(channel.consumeForce()).toBeNull();
    });
  });

  describe('program state', () => {
    it('tracks waiting-for-input state', () => {
      channel.setWaitingForInput(true, { timeout: 30, default: 'a' });
      expect(channel.waitingForInput).toBe(true);
      expect(channel.inputConfig).toEqual({ timeout: 30, default: 'a' });
    });

    it('clears waiting state', () => {
      channel.setWaitingForInput(true, { timeout: 30 });
      channel.setWaitingForInput(false);
      expect(channel.waitingForInput).toBe(false);
      expect(channel.inputConfig).toBeNull();
    });

    it('tracks active program name', () => {
      channel.setProgram('story-adventure');
      expect(channel.activeProgram).toBe('story-adventure');
    });
  });

  describe('toJSON', () => {
    it('serializes channel state', () => {
      channel.enqueue('/audio/next.mp3');
      channel.setCurrentTrack('/audio/now.mp3');
      channel.setProgram('bedtime');

      const json = channel.toJSON();
      expect(json).toEqual({
        name: 'yoto',
        status: 'playing',
        format: 'aac',
        bitrate: 96,
        ambient: 'silence',
        currentTrack: '/audio/now.mp3',
        queue: ['/audio/next.mp3'],
        queueLength: 1,
        activeProgram: 'bedtime',
        waitingForInput: false,
        listenerCount: 0,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/StreamChannel.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StreamChannel**

```javascript
// backend/src/2_domains/livestream/StreamChannel.mjs

/**
 * StreamChannel — domain entity for a named audio stream channel.
 *
 * Owns queue state, current track, force-play flag, and program metadata.
 * Pure domain logic — no I/O or process management.
 */
export class StreamChannel {
  #name;
  #format;
  #bitrate;
  #ambient;
  #queue = [];
  #currentTrack = null;
  #forceTrack = null;
  #activeProgram = null;
  #waitingForInput = false;
  #inputConfig = null;
  #listenerCount = 0;
  #soundboard;

  /**
   * @param {Object} config
   * @param {string} config.name - Channel name (e.g., 'yoto', 'office')
   * @param {string} [config.format='aac'] - Output audio format
   * @param {number} [config.bitrate=96] - Output bitrate in kbps
   * @param {string} [config.ambient='silence'] - Ambient source when queue is empty
   * @param {Array} [config.soundboard=[]] - Soundboard button definitions
   */
  constructor({ name, format = 'aac', bitrate = 96, ambient = 'silence', soundboard = [] }) {
    this.#name = name;
    this.#format = format;
    this.#bitrate = bitrate;
    this.#ambient = ambient;
    this.#soundboard = soundboard;
  }

  get name() { return this.#name; }
  get format() { return this.#format; }
  get bitrate() { return this.#bitrate; }
  get ambient() { return this.#ambient; }
  get soundboard() { return this.#soundboard; }
  get currentTrack() { return this.#currentTrack; }
  get forceTrack() { return this.#forceTrack; }
  get activeProgram() { return this.#activeProgram; }
  get waitingForInput() { return this.#waitingForInput; }
  get inputConfig() { return this.#inputConfig; }
  get listenerCount() { return this.#listenerCount; }
  get queue() { return [...this.#queue]; }
  get queueLength() { return this.#queue.length; }

  get status() {
    if (this.#currentTrack) return 'playing';
    return 'idle';
  }

  // --- Queue operations ---

  enqueue(filePath) {
    this.#queue.push(filePath);
  }

  enqueueAll(filePaths) {
    this.#queue.push(...filePaths);
  }

  dequeue() {
    return this.#queue.shift() ?? null;
  }

  removeAt(index) {
    if (index >= 0 && index < this.#queue.length) {
      this.#queue.splice(index, 1);
    }
  }

  clearQueue() {
    this.#queue = [];
  }

  // --- Playback state ---

  setCurrentTrack(filePath) {
    this.#currentTrack = filePath;
  }

  forcePlay(filePath) {
    this.#forceTrack = filePath;
  }

  consumeForce() {
    const track = this.#forceTrack;
    this.#forceTrack = null;
    return track;
  }

  // --- Program state ---

  setProgram(programName) {
    this.#activeProgram = programName;
  }

  setWaitingForInput(waiting, config = null) {
    this.#waitingForInput = waiting;
    this.#inputConfig = waiting ? config : null;
  }

  // --- Listener tracking ---

  addListener() { this.#listenerCount++; }
  removeListener() { this.#listenerCount = Math.max(0, this.#listenerCount - 1); }

  // --- Serialization ---

  toJSON() {
    return {
      name: this.#name,
      status: this.status,
      format: this.#format,
      bitrate: this.#bitrate,
      ambient: this.#ambient,
      currentTrack: this.#currentTrack,
      queue: this.queue,
      queueLength: this.queueLength,
      activeProgram: this.#activeProgram,
      waitingForInput: this.#waitingForInput,
      listenerCount: this.#listenerCount,
    };
  }
}

export default StreamChannel;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/StreamChannel.test.mjs`
Expected: All 16 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/livestream/StreamChannel.mjs tests/unit/livestream/StreamChannel.test.mjs
git commit -m "feat(livestream): add StreamChannel domain entity with queue, force-play, program state"
```

---

## Task 2: FFmpegStreamAdapter

**Files:**
- Create: `backend/src/1_adapters/livestream/FFmpegStreamAdapter.mjs`
- Create: `tests/unit/livestream/FFmpegStreamAdapter.test.mjs`

Manages the long-lived FFmpeg encoder process and broadcasts AAC output to connected HTTP clients.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/livestream/FFmpegStreamAdapter.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';

// Mock child_process before import
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: mockSpawn }));

import { FFmpegStreamAdapter } from '../../../backend/src/1_adapters/livestream/FFmpegStreamAdapter.mjs';

function createMockProcess() {
  const proc = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    on: vi.fn(),
    pid: 12345,
  };
  return proc;
}

describe('FFmpegStreamAdapter', () => {
  let adapter;
  let mockProc;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    adapter = new FFmpegStreamAdapter({ format: 'aac', bitrate: 96, logger: mockLogger });
  });

  afterEach(() => {
    adapter.stop();
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('spawns ffmpeg encoder process', () => {
      adapter.start();
      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
        '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
        '-c:a', 'aac', '-b:a', '96k', '-f', 'adts', 'pipe:1'
      ]), expect.any(Object));
    });

    it('returns writable stdin for feeding PCM', () => {
      const stdin = adapter.start();
      expect(stdin).toBe(mockProc.stdin);
    });

    it('does not spawn twice if already running', () => {
      adapter.start();
      adapter.start();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('addClient / removeClient', () => {
    it('pipes encoder output to client stream', () => {
      adapter.start();
      const client = new PassThrough();
      const id = adapter.addClient(client);
      expect(typeof id).toBe('string');

      // Simulate encoder output
      mockProc.stdout.push(Buffer.from([0xff, 0xf1, 0x00]));

      // Client should receive the data
      const chunks = [];
      client.on('data', (chunk) => chunks.push(chunk));
      // Give a tick for piping
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(chunks.length).toBeGreaterThan(0);
          resolve();
        }, 10);
      });
    });

    it('removes client without affecting others', () => {
      adapter.start();
      const client1 = new PassThrough();
      const client2 = new PassThrough();
      const id1 = adapter.addClient(client1);
      adapter.addClient(client2);

      adapter.removeClient(id1);
      expect(adapter.clientCount).toBe(1);
    });

    it('reports client count', () => {
      adapter.start();
      expect(adapter.clientCount).toBe(0);
      const c1 = new PassThrough();
      adapter.addClient(c1);
      expect(adapter.clientCount).toBe(1);
    });
  });

  describe('stop', () => {
    it('kills the ffmpeg process', () => {
      adapter.start();
      adapter.stop();
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('is safe to call when not running', () => {
      expect(() => adapter.stop()).not.toThrow();
    });
  });

  describe('isRunning', () => {
    it('reports false before start', () => {
      expect(adapter.isRunning).toBe(false);
    });

    it('reports true after start', () => {
      adapter.start();
      expect(adapter.isRunning).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/FFmpegStreamAdapter.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FFmpegStreamAdapter**

```javascript
// backend/src/1_adapters/livestream/FFmpegStreamAdapter.mjs

import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import crypto from 'crypto';

/**
 * FFmpegStreamAdapter — manages a long-lived FFmpeg AAC encoder process
 * and broadcasts output to connected HTTP clients.
 *
 * The encoder reads raw PCM (s16le, 44100Hz, stereo) from stdin and
 * outputs ADTS-framed AAC to stdout. Clients are PassThrough streams
 * that receive a copy of the encoder output.
 */
export class FFmpegStreamAdapter {
  #format;
  #bitrate;
  #logger;
  #process = null;
  #clients = new Map();
  #buffer = [];
  #bufferMaxBytes = 44100 * 2 * 2 * 30; // ~30s of PCM worth of AAC (overestimate is fine)

  /**
   * @param {Object} config
   * @param {string} [config.format='aac'] - Output codec
   * @param {number} [config.bitrate=96] - Output bitrate in kbps
   * @param {Object} [config.logger=console] - Logger instance
   */
  constructor({ format = 'aac', bitrate = 96, logger = console }) {
    this.#format = format;
    this.#bitrate = bitrate;
    this.#logger = logger;
  }

  get isRunning() {
    return this.#process !== null;
  }

  get clientCount() {
    return this.#clients.size;
  }

  /**
   * Start the FFmpeg encoder process.
   * @returns {import('stream').Writable} stdin — write raw PCM here
   */
  start() {
    if (this.#process) return this.#process.stdin;

    const args = [
      '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
      '-c:a', this.#format, '-b:a', `${this.#bitrate}k`,
      '-f', 'adts', 'pipe:1'
    ];

    this.#process = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.#process.stderr.on('data', (data) => {
      this.#logger.debug?.('livestream.ffmpeg.stderr', { output: data.toString().trim() });
    });

    this.#process.on('exit', (code, signal) => {
      this.#logger.info?.('livestream.ffmpeg.exit', { code, signal });
      this.#process = null;
    });

    this.#process.on('error', (err) => {
      this.#logger.error?.('livestream.ffmpeg.error', { error: err.message });
      this.#process = null;
    });

    // Broadcast encoder output to all clients and maintain rolling buffer
    this.#process.stdout.on('data', (chunk) => {
      // Add to rolling buffer
      this.#buffer.push(chunk);
      this.#trimBuffer();

      // Broadcast to all clients
      for (const [id, client] of this.#clients) {
        if (!client.destroyed) {
          client.write(chunk);
        } else {
          this.#clients.delete(id);
        }
      }
    });

    this.#logger.info?.('livestream.ffmpeg.started', {
      format: this.#format,
      bitrate: this.#bitrate,
      pid: this.#process.pid,
    });

    return this.#process.stdin;
  }

  /**
   * Add a client stream to receive broadcast output.
   * Immediately writes the rolling buffer to catch the client up.
   * @param {import('stream').Writable} stream - Client writable stream
   * @returns {string} Client ID for later removal
   */
  addClient(stream) {
    const id = crypto.randomUUID();

    // Send rolling buffer to new client so they hear audio immediately
    for (const chunk of this.#buffer) {
      if (!stream.destroyed) stream.write(chunk);
    }

    this.#clients.set(id, stream);
    this.#logger.info?.('livestream.client.added', { clientId: id, total: this.#clients.size });
    return id;
  }

  /**
   * Remove a client stream.
   * @param {string} clientId
   */
  removeClient(clientId) {
    this.#clients.delete(clientId);
    this.#logger.info?.('livestream.client.removed', { clientId, total: this.#clients.size });
  }

  /**
   * Stop the FFmpeg process and disconnect all clients.
   */
  stop() {
    if (this.#process) {
      this.#process.kill('SIGTERM');
      this.#process = null;
    }
    this.#clients.clear();
    this.#buffer = [];
  }

  /**
   * Trim rolling buffer to max size.
   * @private
   */
  #trimBuffer() {
    let totalBytes = this.#buffer.reduce((sum, b) => sum + b.length, 0);
    while (totalBytes > this.#bufferMaxBytes && this.#buffer.length > 1) {
      totalBytes -= this.#buffer.shift().length;
    }
  }
}

export default FFmpegStreamAdapter;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/FFmpegStreamAdapter.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/livestream/FFmpegStreamAdapter.mjs tests/unit/livestream/FFmpegStreamAdapter.test.mjs
git commit -m "feat(livestream): add FFmpegStreamAdapter — encoder process + broadcast buffer"
```

---

## Task 3: SourceFeeder

**Files:**
- Create: `backend/src/2_domains/livestream/SourceFeeder.mjs`
- Create: `tests/unit/livestream/SourceFeeder.test.mjs`

Orchestrates what audio gets fed to the FFmpeg encoder. Spawns decoders, manages track transitions, ambient fallback, force-play interrupts.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/livestream/SourceFeeder.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({ spawn: mockSpawn }));

import { SourceFeeder } from '../../../backend/src/2_domains/livestream/SourceFeeder.mjs';

function createMockDecoder() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.kill = vi.fn(() => { proc.emit('exit', null, 'SIGTERM'); });
  proc.pid = Math.floor(Math.random() * 10000);
  return proc;
}

describe('SourceFeeder', () => {
  let feeder;
  let encoderStdin;
  let onTrackEnd;
  let onNeedTrack;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    encoderStdin = new PassThrough();
    onTrackEnd = vi.fn();
    onNeedTrack = vi.fn();
    mockSpawn.mockImplementation(() => createMockDecoder());

    feeder = new SourceFeeder({
      encoderStdin,
      onTrackEnd,
      onNeedTrack,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    feeder.stop();
    vi.clearAllMocks();
  });

  describe('playFile', () => {
    it('spawns ffmpeg decoder for the given file', () => {
      feeder.playFile('/audio/track.mp3');

      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
        '-i', '/audio/track.mp3',
        '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'
      ]), expect.any(Object));
    });

    it('reports the current file path', () => {
      feeder.playFile('/audio/track.mp3');
      expect(feeder.currentFile).toBe('/audio/track.mp3');
    });

    it('calls onTrackEnd when decoder exits normally', () => {
      feeder.playFile('/audio/track.mp3');
      const decoder = mockSpawn.mock.results[0].value;
      decoder.emit('exit', 0, null);
      expect(onTrackEnd).toHaveBeenCalled();
    });

    it('calls onNeedTrack when decoder finishes and feeder is idle', () => {
      feeder.playFile('/audio/track.mp3');
      const decoder = mockSpawn.mock.results[0].value;
      decoder.emit('exit', 0, null);
      expect(onNeedTrack).toHaveBeenCalled();
    });
  });

  describe('interrupt (force-play)', () => {
    it('kills current decoder when playing a new file', () => {
      feeder.playFile('/audio/first.mp3');
      const firstDecoder = mockSpawn.mock.results[0].value;

      feeder.playFile('/audio/second.mp3');
      expect(firstDecoder.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('playSilence', () => {
    it('writes zero-filled PCM to encoder stdin', () => {
      const chunks = [];
      encoderStdin.on('data', (chunk) => chunks.push(chunk));

      feeder.playSilence();

      // Should be writing silence frames
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(chunks.length).toBeGreaterThan(0);
          // Silence = all zeros
          expect(chunks[0].every(b => b === 0)).toBe(true);
          feeder.stop();
          resolve();
        }, 150);
      });
    });
  });

  describe('stop', () => {
    it('kills active decoder', () => {
      feeder.playFile('/audio/track.mp3');
      const decoder = mockSpawn.mock.results[0].value;
      feeder.stop();
      expect(decoder.kill).toHaveBeenCalled();
    });

    it('stops silence generator', () => {
      feeder.playSilence();
      feeder.stop();
      // Verify no more writes after stop
      const chunks = [];
      encoderStdin.on('data', (chunk) => chunks.push(chunk));
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(chunks.length).toBe(0);
          resolve();
        }, 150);
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/SourceFeeder.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SourceFeeder**

```javascript
// backend/src/2_domains/livestream/SourceFeeder.mjs

import { spawn } from 'child_process';

/**
 * SourceFeeder — orchestrates what audio gets fed into the FFmpeg encoder.
 *
 * Responsibilities:
 * - Spawn short-lived FFmpeg decoder per track (any format → PCM)
 * - Pipe decoder PCM output to encoder stdin
 * - Kill decoder on force-play / skip
 * - Generate silence when nothing is playing
 * - Notify when track ends so ChannelManager can pull next from queue
 */
export class SourceFeeder {
  #encoderStdin;
  #onTrackEnd;
  #onNeedTrack;
  #logger;
  #activeDecoder = null;
  #currentFile = null;
  #silenceInterval = null;
  #stopped = false;

  /**
   * @param {Object} config
   * @param {import('stream').Writable} config.encoderStdin - The encoder's stdin to feed PCM into
   * @param {Function} config.onTrackEnd - Called when current track finishes
   * @param {Function} config.onNeedTrack - Called when feeder needs a new track (after track end or on start)
   * @param {Object} [config.logger=console]
   */
  constructor({ encoderStdin, onTrackEnd, onNeedTrack, logger = console }) {
    this.#encoderStdin = encoderStdin;
    this.#onTrackEnd = onTrackEnd;
    this.#onNeedTrack = onNeedTrack;
    this.#logger = logger;
  }

  get currentFile() { return this.#currentFile; }

  /**
   * Play a file by spawning a decoder and piping PCM to the encoder.
   * Kills any active decoder first (supports force-play).
   * @param {string} filePath - Path to audio file
   */
  playFile(filePath) {
    this.#stopSilence();
    this.#killDecoder();

    this.#currentFile = filePath;

    const args = [
      '-i', filePath,
      '-f', 's16le', '-ar', '44100', '-ac', '2',
      'pipe:1'
    ];

    this.#activeDecoder = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.#activeDecoder.stdout.on('data', (chunk) => {
      if (!this.#stopped && !this.#encoderStdin.destroyed) {
        this.#encoderStdin.write(chunk);
      }
    });

    this.#activeDecoder.stderr.on('data', (data) => {
      this.#logger.debug?.('livestream.decoder.stderr', { file: filePath, output: data.toString().trim() });
    });

    this.#activeDecoder.on('exit', (code, signal) => {
      if (this.#stopped) return;

      this.#logger.info?.('livestream.decoder.exit', { file: filePath, code, signal });
      this.#activeDecoder = null;
      this.#currentFile = null;
      this.#onTrackEnd();
      this.#onNeedTrack();
    });

    this.#activeDecoder.on('error', (err) => {
      this.#logger.error?.('livestream.decoder.error', { file: filePath, error: err.message });
      this.#activeDecoder = null;
      this.#currentFile = null;
      this.#onNeedTrack();
    });

    this.#logger.info?.('livestream.decoder.started', { file: filePath, pid: this.#activeDecoder.pid });
  }

  /**
   * Play an ambient file on loop. Restarts the file when it ends.
   * @param {string} filePath - Path to ambient audio file
   */
  playAmbientLoop(filePath) {
    this.#stopSilence();
    this.#killDecoder();

    const playOnce = () => {
      if (this.#stopped) return;
      this.#currentFile = filePath;

      const args = ['-i', filePath, '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1'];
      this.#activeDecoder = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      this.#activeDecoder.stdout.on('data', (chunk) => {
        if (!this.#stopped && !this.#encoderStdin.destroyed) {
          this.#encoderStdin.write(chunk);
        }
      });

      this.#activeDecoder.stderr.on('data', () => {}); // suppress

      this.#activeDecoder.on('exit', () => {
        if (!this.#stopped) playOnce(); // loop
      });

      this.#activeDecoder.on('error', () => {
        if (!this.#stopped) {
          setTimeout(playOnce, 1000); // retry after 1s
        }
      });
    };

    playOnce();
  }

  /**
   * Generate silence — writes zero-filled PCM frames to encoder stdin.
   */
  playSilence() {
    this.#killDecoder();
    this.#stopSilence();

    // 1 second of silence: 44100 samples * 2 channels * 2 bytes
    const frame = Buffer.alloc(44100 * 2 * 2);

    this.#silenceInterval = setInterval(() => {
      if (!this.#stopped && !this.#encoderStdin.destroyed) {
        this.#encoderStdin.write(frame);
      }
    }, 1000);
  }

  /**
   * Stop everything — kill decoder, stop silence.
   */
  stop() {
    this.#stopped = true;
    this.#killDecoder();
    this.#stopSilence();
    this.#currentFile = null;
  }

  /**
   * @private
   */
  #killDecoder() {
    if (this.#activeDecoder) {
      this.#activeDecoder.kill('SIGKILL');
      this.#activeDecoder = null;
    }
  }

  /**
   * @private
   */
  #stopSilence() {
    if (this.#silenceInterval) {
      clearInterval(this.#silenceInterval);
      this.#silenceInterval = null;
    }
  }
}

export default SourceFeeder;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/SourceFeeder.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/livestream/SourceFeeder.mjs tests/unit/livestream/SourceFeeder.test.mjs
git commit -m "feat(livestream): add SourceFeeder — decoder spawning, silence gen, force-play"
```

---

## Task 4: IAudioAssetResolver + TTSAssetResolver

**Files:**
- Create: `backend/src/2_domains/livestream/IAudioAssetResolver.mjs`
- Create: `backend/src/1_adapters/livestream/TTSAssetResolver.mjs`
- Create: `tests/unit/livestream/TTSAssetResolver.test.mjs`

The domain interface and TTS implementation for resolving audio specs to file paths.

- [ ] **Step 1: Write the domain interface**

```javascript
// backend/src/2_domains/livestream/IAudioAssetResolver.mjs

/**
 * IAudioAssetResolver — domain interface for resolving audio specs to playable files.
 *
 * Specs can be:
 * - { type: 'file', path: '/audio/track.mp3' } — pass-through
 * - { type: 'tts', text: 'Hello', voice: 'nova' } — generate speech, return cached path
 *
 * Implementations handle caching, pre-generation, and cleanup.
 */
export class IAudioAssetResolver {
  /**
   * Resolve an audio spec to a playable file path.
   * @param {Object} spec - Audio spec
   * @param {string} spec.type - 'file' or 'tts'
   * @returns {Promise<{ path: string, duration: number | null }>}
   */
  async resolve(spec) {
    throw new Error('IAudioAssetResolver.resolve() must be implemented');
  }

  /**
   * Pre-resolve multiple specs (for pre-generation).
   * @param {Object[]} specs
   * @returns {Promise<Array<{ path: string, duration: number | null }>>}
   */
  async resolveAll(specs) {
    return Promise.all(specs.map(s => this.resolve(s)));
  }
}

export default IAudioAssetResolver;
```

- [ ] **Step 2: Write failing tests for TTSAssetResolver**

```javascript
// tests/unit/livestream/TTSAssetResolver.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { TTSAssetResolver } from '../../../backend/src/1_adapters/livestream/TTSAssetResolver.mjs';

describe('TTSAssetResolver', () => {
  let resolver;
  let mockTTSAdapter;
  let cacheDir;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    cacheDir = path.join(os.tmpdir(), `livestream-tts-test-${Date.now()}`);
    fs.mkdirSync(cacheDir, { recursive: true });

    mockTTSAdapter = {
      isConfigured: vi.fn(() => true),
      generateSpeechBuffer: vi.fn(async () => Buffer.from('fake-mp3-data')),
    };

    resolver = new TTSAssetResolver({
      ttsAdapter: mockTTSAdapter,
      cacheDir,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('resolve file spec', () => {
    it('passes through file specs unchanged', async () => {
      const result = await resolver.resolve({ type: 'file', path: '/audio/track.mp3' });
      expect(result.path).toBe('/audio/track.mp3');
    });
  });

  describe('resolve TTS spec', () => {
    it('generates audio and returns cached path', async () => {
      const result = await resolver.resolve({ type: 'tts', text: 'Hello world', voice: 'nova' });
      expect(result.path).toMatch(/\.mp3$/);
      expect(fs.existsSync(result.path)).toBe(true);
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({ voice: 'nova' })
      );
    });

    it('returns cached file on second call with same text', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(1);
    });

    it('generates new file for different text', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Goodbye', voice: 'nova' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(2);
    });

    it('generates new file for different voice', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'alloy' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveAll', () => {
    it('resolves multiple specs in parallel', async () => {
      const results = await resolver.resolveAll([
        { type: 'file', path: '/audio/a.mp3' },
        { type: 'tts', text: 'Test', voice: 'nova' },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].path).toBe('/audio/a.mp3');
      expect(results[1].path).toMatch(/\.mp3$/);
    });
  });

  describe('cleanup', () => {
    it('removes files older than TTL', async () => {
      await resolver.resolve({ type: 'tts', text: 'Old text', voice: 'nova' });
      // Manually age the file
      const files = fs.readdirSync(cacheDir);
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      for (const f of files) {
        fs.utimesSync(path.join(cacheDir, f), oldTime, oldTime);
      }

      resolver.cleanup(24 * 60 * 60 * 1000); // 24h TTL
      const remaining = fs.readdirSync(cacheDir);
      expect(remaining).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/TTSAssetResolver.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 4: Implement TTSAssetResolver**

```javascript
// backend/src/1_adapters/livestream/TTSAssetResolver.mjs

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IAudioAssetResolver } from '#domains/livestream/IAudioAssetResolver.mjs';

/**
 * TTSAssetResolver — resolves audio specs to playable file paths.
 * File specs pass through. TTS specs are generated via TTSAdapter and cached.
 */
export class TTSAssetResolver extends IAudioAssetResolver {
  #ttsAdapter;
  #cacheDir;
  #logger;
  #cache = new Map(); // hash → file path
  #pinned = new Set(); // hashes that should never be evicted

  /**
   * @param {Object} config
   * @param {Object} config.ttsAdapter - TTSAdapter instance
   * @param {string} config.cacheDir - Directory for cached TTS files
   * @param {Object} [config.logger=console]
   */
  constructor({ ttsAdapter, cacheDir, logger = console }) {
    super();
    this.#ttsAdapter = ttsAdapter;
    this.#cacheDir = cacheDir;
    this.#logger = logger;
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Resolve an audio spec to a playable file path.
   * @param {Object} spec
   * @returns {Promise<{ path: string, duration: number | null }>}
   */
  async resolve(spec) {
    if (spec.type === 'file') {
      return { path: spec.path, duration: null };
    }

    if (spec.type === 'tts') {
      return this.#resolveTTS(spec);
    }

    throw new Error(`Unknown audio spec type: ${spec.type}`);
  }

  /**
   * Pin a hash so it won't be evicted during cleanup.
   * Used for soundboard TTS entries.
   * @param {string} text
   * @param {string} [voice]
   */
  pin(text, voice = 'default') {
    this.#pinned.add(this.#hash(text, voice));
  }

  /**
   * Remove cached files older than ttlMs.
   * Pinned entries are skipped.
   * @param {number} ttlMs - Max age in milliseconds
   */
  cleanup(ttlMs) {
    const now = Date.now();
    const files = fs.readdirSync(this.#cacheDir);

    for (const file of files) {
      const filePath = path.join(this.#cacheDir, file);
      const stat = fs.statSync(filePath);
      const age = now - stat.mtimeMs;

      // Check if pinned
      const hashFromName = path.basename(file, path.extname(file));
      if (this.#pinned.has(hashFromName)) continue;

      if (age > ttlMs) {
        fs.unlinkSync(filePath);
        this.#cache.delete(hashFromName);
        this.#logger.debug?.('livestream.tts.cache.evict', { file, ageHours: Math.round(age / 3600000) });
      }
    }
  }

  /**
   * @private
   */
  async #resolveTTS(spec) {
    const hash = this.#hash(spec.text, spec.voice || 'default');

    // Check in-memory cache
    if (this.#cache.has(hash)) {
      const cached = this.#cache.get(hash);
      if (fs.existsSync(cached)) {
        this.#logger.debug?.('livestream.tts.cache.hit', { hash });
        return { path: cached, duration: null };
      }
      this.#cache.delete(hash);
    }

    // Generate
    this.#logger.info?.('livestream.tts.generate', { textLength: spec.text.length, voice: spec.voice });
    const buffer = await this.#ttsAdapter.generateSpeechBuffer(spec.text, {
      voice: spec.voice,
      model: spec.model,
      responseFormat: 'mp3',
    });

    const filePath = path.join(this.#cacheDir, `${hash}.mp3`);
    fs.writeFileSync(filePath, buffer);
    this.#cache.set(hash, filePath);

    this.#logger.info?.('livestream.tts.cached', { hash, path: filePath, bytes: buffer.length });
    return { path: filePath, duration: null };
  }

  /**
   * @private
   */
  #hash(text, voice) {
    return crypto.createHash('sha256').update(`${voice}:${text}`).digest('hex').slice(0, 16);
  }
}

export default TTSAssetResolver;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/TTSAssetResolver.test.mjs`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/2_domains/livestream/IAudioAssetResolver.mjs backend/src/1_adapters/livestream/TTSAssetResolver.mjs tests/unit/livestream/TTSAssetResolver.test.mjs
git commit -m "feat(livestream): add IAudioAssetResolver interface + TTSAssetResolver with caching"
```

---

## Task 5: ChannelManager Application Service

**Files:**
- Create: `backend/src/3_applications/livestream/ChannelManager.mjs`
- Create: `tests/unit/livestream/ChannelManager.test.mjs`

Orchestrates channel lifecycle — CRUD, wires SourceFeeder ↔ StreamChannel ↔ FFmpegStreamAdapter, routes commands.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/livestream/ChannelManager.test.mjs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

// Mock FFmpegStreamAdapter
vi.mock('../../../backend/src/1_adapters/livestream/FFmpegStreamAdapter.mjs', () => {
  return {
    FFmpegStreamAdapter: vi.fn().mockImplementation(() => ({
      start: vi.fn(() => new PassThrough()),
      stop: vi.fn(),
      addClient: vi.fn(() => 'client-1'),
      removeClient: vi.fn(),
      get isRunning() { return true; },
      get clientCount() { return 0; },
    })),
  };
});

// Mock SourceFeeder
vi.mock('../../../backend/src/2_domains/livestream/SourceFeeder.mjs', () => {
  return {
    SourceFeeder: vi.fn().mockImplementation(({ onNeedTrack }) => {
      const feeder = {
        playFile: vi.fn(),
        playSilence: vi.fn(),
        playAmbientLoop: vi.fn(),
        stop: vi.fn(),
        get currentFile() { return null; },
        _onNeedTrack: onNeedTrack,
      };
      return feeder;
    }),
  };
});

import { ChannelManager } from '../../../backend/src/3_applications/livestream/ChannelManager.mjs';

describe('ChannelManager', () => {
  let manager;
  let mockBroadcast;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    mockBroadcast = vi.fn();
    manager = new ChannelManager({
      mediaBasePath: '/media',
      broadcastEvent: mockBroadcast,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    manager.destroyAll();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a named channel', () => {
      manager.create('yoto', { bitrate: 96, ambient: 'silence' });
      const channels = manager.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0].name).toBe('yoto');
    });

    it('throws if channel name already exists', () => {
      manager.create('yoto', {});
      expect(() => manager.create('yoto', {})).toThrow(/already exists/);
    });

    it('starts the FFmpeg encoder', () => {
      manager.create('yoto', {});
      const status = manager.getStatus('yoto');
      expect(status).toBeTruthy();
      expect(status.name).toBe('yoto');
    });
  });

  describe('destroy', () => {
    it('stops and removes a channel', () => {
      manager.create('yoto', {});
      manager.destroy('yoto');
      expect(manager.listChannels()).toHaveLength(0);
    });

    it('throws if channel does not exist', () => {
      expect(() => manager.destroy('nonexistent')).toThrow(/not found/);
    });
  });

  describe('queue', () => {
    it('adds files to channel queue', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3', '/audio/b.mp3']);
      const status = manager.getStatus('yoto');
      expect(status.queueLength).toBe(2);
    });

    it('broadcasts queue update', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3']);
      expect(mockBroadcast).toHaveBeenCalledWith(
        'livestream:yoto',
        expect.objectContaining({ name: 'yoto' })
      );
    });
  });

  describe('forcePlay', () => {
    it('sets force track on channel', () => {
      manager.create('yoto', {});
      manager.forcePlay('yoto', '/audio/urgent.mp3');
      // Force should be consumed by the feeder integration
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('triggers next track', () => {
      manager.create('yoto', {});
      manager.queueFiles('yoto', ['/audio/a.mp3', '/audio/b.mp3']);
      manager.skip('yoto');
      expect(mockBroadcast).toHaveBeenCalled();
    });
  });

  describe('getClientStream', () => {
    it('returns a readable stream for HTTP clients', () => {
      manager.create('yoto', {});
      const { stream, clientId } = manager.getClientStream('yoto');
      expect(stream).toBeInstanceOf(PassThrough);
      expect(typeof clientId).toBe('string');
    });

    it('throws if channel does not exist', () => {
      expect(() => manager.getClientStream('nope')).toThrow(/not found/);
    });
  });

  describe('sendInput', () => {
    it('stores input choice on channel', () => {
      manager.create('yoto', {});
      // No program running, but input should not throw
      expect(() => manager.sendInput('yoto', 'a')).not.toThrow();
    });
  });

  describe('listChannels', () => {
    it('returns all channels as JSON', () => {
      manager.create('yoto', { bitrate: 96 });
      manager.create('office', { bitrate: 128 });
      const list = manager.listChannels();
      expect(list).toHaveLength(2);
      expect(list.map(c => c.name).sort()).toEqual(['office', 'yoto']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/ChannelManager.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChannelManager**

```javascript
// backend/src/3_applications/livestream/ChannelManager.mjs

import { PassThrough } from 'stream';
import { StreamChannel } from '#domains/livestream/StreamChannel.mjs';
import { SourceFeeder } from '#domains/livestream/SourceFeeder.mjs';
import { FFmpegStreamAdapter } from '#adapters/livestream/FFmpegStreamAdapter.mjs';

/**
 * ChannelManager — application service for livestream channels.
 *
 * Orchestrates channel lifecycle: create/destroy channels, wire up
 * FFmpegStreamAdapter ↔ SourceFeeder ↔ StreamChannel, route commands.
 */
export class ChannelManager {
  #channels = new Map();    // name → { channel, adapter, feeder }
  #mediaBasePath;
  #broadcastEvent;
  #logger;

  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for resolving audio files
   * @param {Function} config.broadcastEvent - (topic, payload) => void
   * @param {Object} [config.logger=console]
   */
  constructor({ mediaBasePath, broadcastEvent, logger = console }) {
    this.#mediaBasePath = mediaBasePath;
    this.#broadcastEvent = broadcastEvent;
    this.#logger = logger;
  }

  /**
   * Create and start a new channel.
   * @param {string} name
   * @param {Object} config - Channel config (format, bitrate, ambient, soundboard)
   */
  create(name, config = {}) {
    if (this.#channels.has(name)) {
      throw new Error(`Channel "${name}" already exists`);
    }

    const channel = new StreamChannel({ name, ...config });

    const adapter = new FFmpegStreamAdapter({
      format: channel.format,
      bitrate: channel.bitrate,
      logger: this.#logger,
    });

    const encoderStdin = adapter.start();

    const feeder = new SourceFeeder({
      encoderStdin,
      onTrackEnd: () => {
        channel.setCurrentTrack(null);
        this.#broadcast(name);
      },
      onNeedTrack: () => this.#feedNext(name),
      logger: this.#logger,
    });

    this.#channels.set(name, { channel, adapter, feeder, runner: null });

    // Start ambient
    this.#startAmbient(name);

    this.#logger.info?.('livestream.channel.created', { name, format: channel.format, bitrate: channel.bitrate });
    this.#broadcast(name);
  }

  /**
   * Stop and remove a channel.
   * @param {string} name
   */
  destroy(name) {
    const entry = this.#getEntry(name);
    entry.feeder.stop();
    entry.adapter.stop();
    this.#channels.delete(name);
    this.#logger.info?.('livestream.channel.destroyed', { name });
  }

  /**
   * Destroy all channels.
   */
  destroyAll() {
    for (const name of [...this.#channels.keys()]) {
      const entry = this.#channels.get(name);
      entry.feeder.stop();
      entry.adapter.stop();
      this.#channels.delete(name);
    }
  }

  /**
   * Add files to a channel's queue.
   * @param {string} name
   * @param {string[]} files - File paths (relative to media base or absolute)
   */
  queueFiles(name, files) {
    const { channel } = this.#getEntry(name);
    channel.enqueueAll(files);
    this.#logger.info?.('livestream.queue.add', { channel: name, count: files.length });

    // If idle, start playing
    if (channel.status === 'idle') {
      this.#feedNext(name);
    }

    this.#broadcast(name);
  }

  /**
   * Remove a queue item by index.
   * @param {string} name
   * @param {number} index
   */
  removeFromQueue(name, index) {
    const { channel } = this.#getEntry(name);
    channel.removeAt(index);
    this.#broadcast(name);
  }

  /**
   * Force-play a file immediately, interrupting current playback.
   * @param {string} name
   * @param {string} file
   */
  forcePlay(name, file) {
    const { channel, feeder } = this.#getEntry(name);
    channel.setCurrentTrack(file);
    feeder.playFile(file);
    this.#logger.info?.('livestream.force', { channel: name, file });
    this.#broadcast(name);
  }

  /**
   * Skip current track and play next in queue.
   * @param {string} name
   */
  skip(name) {
    const { channel, feeder } = this.#getEntry(name);
    channel.setCurrentTrack(null);
    feeder.stop();
    this.#feedNext(name);
    this.#logger.info?.('livestream.skip', { channel: name });
    this.#broadcast(name);
  }

  /**
   * Stop playback and fall to ambient.
   * @param {string} name
   */
  stopPlayback(name) {
    const { channel } = this.#getEntry(name);
    channel.setCurrentTrack(null);
    channel.clearQueue();
    this.#startAmbient(name);
    this.#logger.info?.('livestream.stop', { channel: name });
    this.#broadcast(name);
  }

  /**
   * Send button input (A/B/C/D) to a channel's program.
   * @param {string} name
   * @param {string} choice - 'a', 'b', 'c', or 'd'
   */
  sendInput(name, choice) {
    const { channel } = this.#getEntry(name);
    // ProgramRunner integration will be wired in Task 7
    this.#logger.info?.('livestream.input', { channel: name, choice });
    this.#broadcast(name);
  }

  /**
   * Get a PassThrough stream for an HTTP client.
   * @param {string} name
   * @returns {{ stream: PassThrough, clientId: string }}
   */
  getClientStream(name) {
    const { channel, adapter } = this.#getEntry(name);
    const stream = new PassThrough();
    const clientId = adapter.addClient(stream);
    channel.addListener();

    stream.on('close', () => {
      adapter.removeClient(clientId);
      channel.removeListener();
      this.#broadcast(name);
    });

    return { stream, clientId };
  }

  /**
   * Get channel status.
   * @param {string} name
   * @returns {Object}
   */
  getStatus(name) {
    const { channel } = this.#getEntry(name);
    return channel.toJSON();
  }

  /**
   * List all channels.
   * @returns {Object[]}
   */
  listChannels() {
    return [...this.#channels.values()].map(({ channel }) => channel.toJSON());
  }

  // --- Private ---

  /**
   * Pull next track from queue and play it, or start ambient.
   * @private
   */
  #feedNext(name) {
    if (!this.#channels.has(name)) return;
    const { channel, feeder } = this.#channels.get(name);

    const next = channel.dequeue();
    if (next) {
      channel.setCurrentTrack(next);
      feeder.playFile(next);
      this.#broadcast(name);
    } else {
      this.#startAmbient(name);
    }
  }

  /**
   * Start ambient source for a channel.
   * @private
   */
  #startAmbient(name) {
    const { channel, feeder } = this.#channels.get(name);
    const ambient = channel.ambient;

    if (ambient === 'silence' || !ambient) {
      feeder.playSilence();
    } else if (ambient.startsWith('file:')) {
      const filePath = ambient.slice(5); // strip 'file:' prefix
      feeder.playAmbientLoop(filePath);
    } else {
      feeder.playSilence();
    }
  }

  /**
   * Broadcast channel status via EventBus.
   * @private
   */
  #broadcast(name) {
    if (!this.#channels.has(name)) return;
    const { channel } = this.#channels.get(name);
    this.#broadcastEvent(`livestream:${name}`, channel.toJSON());
  }

  /**
   * Get channel entry or throw.
   * @private
   */
  #getEntry(name) {
    const entry = this.#channels.get(name);
    if (!entry) throw new Error(`Channel "${name}" not found`);
    return entry;
  }
}

export default ChannelManager;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/ChannelManager.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/livestream/ChannelManager.mjs tests/unit/livestream/ChannelManager.test.mjs
git commit -m "feat(livestream): add ChannelManager — channel CRUD, queue, force-play, client streams"
```

---

## Task 6: Livestream API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/livestream.mjs`

Express router with all livestream endpoints. No new tests here — tested via integration in Task 10.

- [ ] **Step 1: Implement the router**

```javascript
// backend/src/4_api/v1/routers/livestream.mjs

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create livestream router.
 *
 * Endpoints:
 * - GET  /livestream/:channel/listen        — AAC audio stream (Icecast-style)
 * - GET  /livestream/channels               — list all channels
 * - POST /livestream/channels               — create channel
 * - GET  /livestream/:channel               — channel status
 * - PUT  /livestream/:channel               — update channel config
 * - DELETE /livestream/:channel             — destroy channel
 * - POST /livestream/:channel/queue         — append to queue
 * - DELETE /livestream/:channel/queue/:index — remove from queue
 * - POST /livestream/:channel/skip          — skip current track
 * - POST /livestream/:channel/force         — force-play immediately
 * - POST /livestream/:channel/stop          — stop, fall to ambient
 * - POST /livestream/:channel/program/start — start a program
 * - POST /livestream/:channel/program/stop  — stop current program
 * - POST /livestream/:channel/input/:choice — send A/B/C/D input
 *
 * @param {Object} config
 * @param {import('#apps/livestream/ChannelManager.mjs').ChannelManager} config.channelManager
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createLivestreamRouter(config) {
  const router = express.Router();
  const { channelManager, logger = console } = config;

  router.use(express.json({ strict: false }));

  // ==========================================================================
  // Stream endpoint — the "radio station"
  // ==========================================================================

  router.get('/:channel/listen', (req, res) => {
    const { channel } = req.params;

    try {
      const { stream, clientId } = channelManager.getClientStream(channel);

      res.writeHead(200, {
        'Content-Type': 'audio/aac',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'icy-name': `DaylightStation - ${channel}`,
        'icy-pub': '0',
        'Access-Control-Allow-Origin': '*',
      });

      stream.pipe(res);

      req.on('close', () => {
        stream.destroy();
        logger.info?.('livestream.client.disconnected', { channel, clientId });
      });

      logger.info?.('livestream.client.connected', { channel, clientId });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ==========================================================================
  // Channel CRUD
  // ==========================================================================

  router.get('/channels', (req, res) => {
    res.json({ channels: channelManager.listChannels() });
  });

  router.post('/channels', asyncHandler(async (req, res) => {
    const { name, ...config } = req.body;
    if (!name) return res.status(400).json({ error: 'Channel name is required' });

    try {
      channelManager.create(name, config);
      res.status(201).json(channelManager.getStatus(name));
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  }));

  router.get('/:channel', (req, res) => {
    try {
      res.json(channelManager.getStatus(req.params.channel));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put('/:channel', asyncHandler(async (req, res) => {
    const { channel } = req.params;
    try {
      // Recreate with new config
      const status = channelManager.getStatus(channel);
      channelManager.destroy(channel);
      channelManager.create(channel, { ...status, ...req.body });
      res.json(channelManager.getStatus(channel));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }));

  router.delete('/:channel', (req, res) => {
    try {
      channelManager.destroy(req.params.channel);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ==========================================================================
  // Playback control
  // ==========================================================================

  router.post('/:channel/queue', asyncHandler(async (req, res) => {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    channelManager.queueFiles(req.params.channel, files);
    res.json(channelManager.getStatus(req.params.channel));
  }));

  router.delete('/:channel/queue/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    channelManager.removeFromQueue(req.params.channel, index);
    res.json(channelManager.getStatus(req.params.channel));
  });

  router.post('/:channel/skip', (req, res) => {
    channelManager.skip(req.params.channel);
    res.json(channelManager.getStatus(req.params.channel));
  });

  router.post('/:channel/force', asyncHandler(async (req, res) => {
    const { file } = req.body;
    if (!file) return res.status(400).json({ error: 'file is required' });
    channelManager.forcePlay(req.params.channel, file);
    res.json(channelManager.getStatus(req.params.channel));
  }));

  router.post('/:channel/stop', (req, res) => {
    channelManager.stopPlayback(req.params.channel);
    res.json(channelManager.getStatus(req.params.channel));
  });

  // ==========================================================================
  // Program control
  // ==========================================================================

  router.post('/:channel/program/start', asyncHandler(async (req, res) => {
    const { program } = req.body;
    if (!program) return res.status(400).json({ error: 'program name is required' });
    // ProgramRunner integration — wired in Task 7
    logger.info?.('livestream.program.start.request', { channel: req.params.channel, program });
    res.json({ ok: true, message: 'Program support coming in next phase' });
  }));

  router.post('/:channel/program/stop', (req, res) => {
    logger.info?.('livestream.program.stop.request', { channel: req.params.channel });
    res.json({ ok: true, message: 'Program support coming in next phase' });
  });

  // ==========================================================================
  // Button input
  // ==========================================================================

  router.post('/:channel/input/:choice', (req, res) => {
    const { channel, choice } = req.params;
    const validChoices = ['a', 'b', 'c', 'd'];
    if (!validChoices.includes(choice.toLowerCase())) {
      return res.status(400).json({ error: `Invalid choice "${choice}". Must be a, b, c, or d` });
    }
    channelManager.sendInput(channel, choice.toLowerCase());
    res.json({ ok: true, channel, choice });
  });

  return router;
}

export default createLivestreamRouter;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/livestream.mjs
git commit -m "feat(livestream): add API router — stream, CRUD, playback, input endpoints"
```

---

## Task 7: Bootstrap Wiring + Manifest

**Files:**
- Create: `backend/src/1_adapters/livestream/manifest.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` — add `createLivestreamServices` factory
- Modify: `backend/src/app.mjs` — register livestream router

- [ ] **Step 1: Create adapter manifest**

```javascript
// backend/src/1_adapters/livestream/manifest.mjs

export default {
  provider: 'livestream',
  capability: 'livestream',
  displayName: 'LiveStream Engine',

  adapter: () => import('./FFmpegStreamAdapter.mjs'),

  configSchema: {
    channels: { type: 'object', description: 'Channel definitions (name → config)' },
    programs: { type: 'object', description: 'Program definitions (name → { type, path })' },
  },
};
```

- [ ] **Step 2: Add factory function to bootstrap.mjs**

Find the end of the factory functions section in `backend/src/0_system/bootstrap.mjs` (near other `create*` functions) and add:

```javascript
/**
 * Create livestream services.
 * @param {Object} config
 * @param {string} config.mediaBasePath - Base path for media files
 * @param {Function} config.broadcastEvent - EventBus broadcast function
 * @param {Object} [config.logger]
 * @returns {{ channelManager: ChannelManager }}
 */
export function createLivestreamServices(config) {
  const { mediaBasePath, broadcastEvent, logger = console } = config;

  const { ChannelManager } = await import('#apps/livestream/ChannelManager.mjs');

  const channelManager = new ChannelManager({
    mediaBasePath,
    broadcastEvent,
    logger,
  });

  return { channelManager };
}
```

Note: The actual insertion point and whether to use `await import()` or top-level import depends on how other factories are structured in bootstrap.mjs. Follow the existing pattern (check if other factories use dynamic or static imports).

- [ ] **Step 3: Register the router in app.mjs**

Find where `v1Routers` is populated in `backend/src/app.mjs` and add:

```javascript
// Livestream engine
const { createLivestreamRouter } = await import('#api/v1/routers/livestream.mjs');
const { ChannelManager } = await import('#apps/livestream/ChannelManager.mjs');

const channelManager = new ChannelManager({
  mediaBasePath,
  broadcastEvent: (topic, payload) => eventBus.broadcast(topic, payload),
  logger: rootLogger.child({ module: 'livestream' }),
});

v1Routers.livestream = createLivestreamRouter({
  channelManager,
  logger: rootLogger.child({ module: 'livestream-api' }),
});
```

The exact insertion point should follow the existing pattern — look for where other routers like `v1Routers.media` or `v1Routers.health` are created. Use the same import style (static or dynamic) as other routers in that section.

- [ ] **Step 4: Verify the server starts**

```bash
# Check if dev server is running
ss -tlnp | grep 3112
# If not running, start it:
node backend/index.js &
# Check for errors in startup log
sleep 3 && curl -s http://localhost:3112/api/v1/livestream/channels
```

Expected: `{"channels":[]}` (empty list, no errors)

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/livestream/manifest.mjs backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(livestream): wire ChannelManager + router into bootstrap and app"
```

---

## Task 8: ProgramRunner (YAML State Machine)

**Files:**
- Create: `backend/src/2_domains/livestream/ProgramRunner.mjs`
- Create: `tests/unit/livestream/ProgramRunner.test.mjs`

Executes YAML state machine programs. Manages state transitions, input waiting, and track queueing.

- [ ] **Step 1: Write failing tests**

```javascript
// tests/unit/livestream/ProgramRunner.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgramRunner } from '../../../backend/src/2_domains/livestream/ProgramRunner.mjs';

const simpleProgram = {
  name: 'Test Program',
  start: 'intro',
  states: {
    intro: {
      play: '/audio/intro.mp3',
      then: { next: 'middle' },
    },
    middle: {
      play: '/audio/middle.mp3',
      then: {
        wait_for_input: { timeout: 30, default: 'a' },
        transitions: { a: 'path-a', b: 'path-b' },
      },
    },
    'path-a': {
      play: '/audio/path-a.mp3',
      then: 'stop',
    },
    'path-b': {
      queue: ['/audio/b1.mp3', '/audio/b2.mp3'],
      then: 'stop',
    },
  },
};

const conditionalProgram = {
  name: 'Conditional',
  start: 'check',
  states: {
    check: {
      condition: {
        time_before: '08:00',
        then: 'morning',
        default: 'daytime',
      },
    },
    morning: { play: '/audio/morning.mp3', then: 'stop' },
    daytime: { play: '/audio/daytime.mp3', then: 'stop' },
  },
};

const randomProgram = {
  name: 'Random',
  start: 'pick',
  states: {
    pick: {
      random_pick: [
        { weight: 1, next: 'option-a' },
        { weight: 1, next: 'option-b' },
      ],
    },
    'option-a': { play: '/audio/a.mp3', then: 'stop' },
    'option-b': { play: '/audio/b.mp3', then: 'stop' },
  },
};

describe('ProgramRunner', () => {
  let runner;
  let mockChannel;

  beforeEach(() => {
    mockChannel = {
      playFile: vi.fn(),
      queueFiles: vi.fn(),
      setWaitingForInput: vi.fn(),
      setProgram: vi.fn(),
    };
  });

  describe('start', () => {
    it('enters the start state and returns play action', () => {
      runner = new ProgramRunner(simpleProgram);
      const action = runner.start();
      expect(action).toEqual({ type: 'play', file: '/audio/intro.mp3' });
      expect(runner.currentState).toBe('intro');
    });

    it('throws if start state does not exist', () => {
      expect(() => new ProgramRunner({ start: 'missing', states: {} })).toThrow(/not found/);
    });
  });

  describe('advance (after track ends)', () => {
    it('transitions to next state via then.next', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start(); // intro
      const action = runner.advance();
      expect(runner.currentState).toBe('middle');
      expect(action).toEqual({ type: 'play', file: '/audio/middle.mp3' });
    });

    it('returns wait_for_input action when state requires input', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start(); // intro
      runner.advance(); // middle - play file
      const action = runner.advance(); // middle - then clause
      expect(action).toEqual({
        type: 'wait_for_input',
        timeout: 30,
        default: 'a',
        transitions: { a: 'path-a', b: 'path-b' },
      });
      expect(runner.isWaitingForInput).toBe(true);
    });

    it('returns stop action when then is "stop"', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // → middle
      runner.advance(); // middle then → wait
      runner.receiveInput('a'); // → path-a
      const action = runner.advance(); // path-a then → stop
      expect(action).toEqual({ type: 'stop' });
      expect(runner.isFinished).toBe(true);
    });
  });

  describe('receiveInput', () => {
    it('transitions to the chosen state', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // → middle
      runner.advance(); // → wait_for_input

      const action = runner.receiveInput('b');
      expect(runner.currentState).toBe('path-b');
      expect(action).toEqual({
        type: 'queue',
        files: ['/audio/b1.mp3', '/audio/b2.mp3'],
      });
      expect(runner.isWaitingForInput).toBe(false);
    });

    it('uses default choice on timeout', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance();
      runner.advance(); // → wait_for_input

      const action = runner.receiveInput(null); // timeout → default 'a'
      expect(runner.currentState).toBe('path-a');
    });

    it('throws if not waiting for input', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      expect(() => runner.receiveInput('a')).toThrow(/not waiting/);
    });
  });

  describe('queue action', () => {
    it('returns queue action with file list', () => {
      runner = new ProgramRunner(simpleProgram);
      runner.start();
      runner.advance(); // middle
      runner.advance(); // wait
      const action = runner.receiveInput('b'); // path-b
      expect(action.type).toBe('queue');
      expect(action.files).toEqual(['/audio/b1.mp3', '/audio/b2.mp3']);
    });
  });

  describe('random_pick', () => {
    it('picks a random state based on weights', () => {
      runner = new ProgramRunner(randomProgram);
      const action = runner.start();
      // Should transition to either option-a or option-b
      expect(['option-a', 'option-b']).toContain(runner.currentState);
      expect(action.type).toBe('play');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/livestream/ProgramRunner.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProgramRunner**

```javascript
// backend/src/2_domains/livestream/ProgramRunner.mjs

/**
 * ProgramRunner — executes YAML state machine programs.
 *
 * A program is a set of named states. Each state has an action (play, queue)
 * and a transition rule (next, wait_for_input, condition, random_pick, stop).
 *
 * The runner is driven externally: start() begins, advance() is called when
 * a track finishes, receiveInput() provides button choices.
 */
export class ProgramRunner {
  #states;
  #currentState = null;
  #waitingForInput = false;
  #inputConfig = null;
  #finished = false;
  #pendingThen = null; // deferred then-clause after play completes

  /**
   * @param {Object} program - Parsed YAML program
   * @param {string} program.start - Name of the start state
   * @param {Object} program.states - Map of state name → state definition
   */
  constructor(program) {
    this.#states = program.states;
    if (!this.#states[program.start]) {
      throw new Error(`Start state "${program.start}" not found in program`);
    }
    this.#currentState = program.start;
  }

  get currentState() { return this.#currentState; }
  get isWaitingForInput() { return this.#waitingForInput; }
  get isFinished() { return this.#finished; }

  /**
   * Start the program — enter the start state and return its action.
   * @returns {Object} Action to execute
   */
  start() {
    return this.#enterState(this.#currentState);
  }

  /**
   * Advance after a track/queue finishes. Evaluates the pending then-clause.
   * @returns {Object} Next action
   */
  advance() {
    if (this.#finished) return { type: 'stop' };

    if (this.#pendingThen) {
      const then = this.#pendingThen;
      this.#pendingThen = null;
      return this.#evaluateThen(then);
    }

    return { type: 'stop' };
  }

  /**
   * Receive button input while waiting.
   * @param {string|null} choice - 'a', 'b', 'c', 'd', or null for timeout/default
   * @returns {Object} Next action
   */
  receiveInput(choice) {
    if (!this.#waitingForInput) {
      throw new Error('Program is not waiting for input');
    }

    const resolvedChoice = choice || this.#inputConfig.default;
    const nextState = this.#inputConfig.transitions[resolvedChoice];

    this.#waitingForInput = false;
    this.#inputConfig = null;

    if (!nextState || !this.#states[nextState]) {
      return { type: 'stop' };
    }

    return this.#enterState(nextState);
  }

  /**
   * Enter a state and return its action.
   * @private
   */
  #enterState(stateName) {
    this.#currentState = stateName;
    const state = this.#states[stateName];

    if (!state) {
      this.#finished = true;
      return { type: 'stop' };
    }

    // Handle immediate transitions (condition, random_pick)
    if (state.condition) {
      return this.#evaluateCondition(state.condition);
    }

    if (state.random_pick) {
      return this.#evaluateRandomPick(state.random_pick);
    }

    // Store then-clause for after play/queue finishes
    if (state.then) {
      this.#pendingThen = state.then;
    }

    // Play action
    if (state.play) {
      return { type: 'play', file: state.play };
    }

    // Queue action
    if (state.queue) {
      return { type: 'queue', files: Array.isArray(state.queue) ? state.queue : [state.queue] };
    }

    // No action — evaluate then immediately
    if (state.then) {
      this.#pendingThen = null;
      return this.#evaluateThen(state.then);
    }

    this.#finished = true;
    return { type: 'stop' };
  }

  /**
   * Evaluate a then-clause.
   * @private
   */
  #evaluateThen(then) {
    if (then === 'stop') {
      this.#finished = true;
      return { type: 'stop' };
    }

    if (typeof then === 'string') {
      // Direct state name
      return this.#enterState(then);
    }

    if (then.next) {
      return this.#enterState(then.next);
    }

    if (then.wait_for_input) {
      this.#waitingForInput = true;
      this.#inputConfig = {
        timeout: then.wait_for_input.timeout || 30,
        default: then.wait_for_input.default || 'a',
        transitions: then.transitions || {},
      };

      // If there's a prompt to play while waiting
      if (then.prompt) {
        return {
          type: 'wait_for_input',
          prompt: then.prompt,
          timeout: this.#inputConfig.timeout,
          default: this.#inputConfig.default,
          transitions: this.#inputConfig.transitions,
        };
      }

      return {
        type: 'wait_for_input',
        timeout: this.#inputConfig.timeout,
        default: this.#inputConfig.default,
        transitions: this.#inputConfig.transitions,
      };
    }

    this.#finished = true;
    return { type: 'stop' };
  }

  /**
   * Evaluate a condition block (time-based, etc).
   * @private
   */
  #evaluateCondition(condition) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (condition.time_before && timeStr < condition.time_before) {
      return this.#enterState(condition.then);
    }

    if (condition.time_after && timeStr >= condition.time_after) {
      return this.#enterState(condition.then);
    }

    return this.#enterState(condition.default);
  }

  /**
   * Pick a random state based on weights.
   * @private
   */
  #evaluateRandomPick(picks) {
    const totalWeight = picks.reduce((sum, p) => sum + (p.weight || 1), 0);
    let random = Math.random() * totalWeight;

    for (const pick of picks) {
      random -= (pick.weight || 1);
      if (random <= 0) {
        return this.#enterState(pick.next);
      }
    }

    // Fallback to last
    return this.#enterState(picks[picks.length - 1].next);
  }
}

export default ProgramRunner;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/livestream/ProgramRunner.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/livestream/ProgramRunner.mjs tests/unit/livestream/ProgramRunner.test.mjs
git commit -m "feat(livestream): add ProgramRunner — YAML state machine with input, conditions, random"
```

---

## Task 9: Wire ProgramRunner into ChannelManager

**Files:**
- Modify: `backend/src/3_applications/livestream/ChannelManager.mjs`
- Modify: `backend/src/4_api/v1/routers/livestream.mjs`

Connect ProgramRunner to ChannelManager so programs can drive channels. Update the API router's program endpoints.

- [ ] **Step 1: Add program loading to ChannelManager**

Add these fields and methods to `ChannelManager`:

```javascript
// Add to constructor:
#programsBasePath;  // set from config
#assetResolver;     // IAudioAssetResolver instance (optional)

// In constructor params, add:
// programsBasePath, assetResolver (optional)
```

Add methods:

```javascript
/**
 * Start a program on a channel.
 * @param {string} channelName
 * @param {string} programName
 * @param {Object} programDef - { type: 'yaml'|'js', path: string }
 */
async startProgram(channelName, programName, programDef) {
  const entry = this.#getEntry(channelName);

  if (programDef.type === 'yaml') {
    const fs = await import('fs');
    const yaml = await import('js-yaml');
    const fullPath = path.join(this.#programsBasePath, programDef.path);
    const content = fs.readFileSync(fullPath, 'utf8');
    const program = yaml.load(content);

    const { ProgramRunner } = await import('#domains/livestream/ProgramRunner.mjs');
    const runner = new ProgramRunner(program);
    entry.runner = runner;
    entry.channel.setProgram(programName);

    // Execute first action
    const action = runner.start();
    this.#executeAction(channelName, action);
  }

  this.#broadcast(channelName);
}

/**
 * Stop the running program on a channel.
 * @param {string} channelName
 */
stopProgram(channelName) {
  const entry = this.#getEntry(channelName);
  entry.runner = null;
  entry.channel.setProgram(null);
  entry.channel.setWaitingForInput(false);
  this.stopPlayback(channelName);
}

/**
 * Send input to a channel's running program.
 * @param {string} channelName
 * @param {string} choice
 */
sendInput(channelName, choice) {
  const entry = this.#getEntry(channelName);
  if (!entry.runner || !entry.runner.isWaitingForInput) {
    this.#logger.warn?.('livestream.input.no_program', { channel: channelName, choice });
    return;
  }

  entry.channel.setWaitingForInput(false);
  const action = entry.runner.receiveInput(choice);
  this.#executeAction(channelName, action);
  this.#broadcast(channelName);
}

/**
 * Execute a program action.
 * @private
 */
#executeAction(channelName, action) {
  const entry = this.#channels.get(channelName);
  if (!entry) return;

  switch (action.type) {
    case 'play':
      entry.channel.setCurrentTrack(action.file);
      entry.feeder.playFile(action.file);
      break;

    case 'queue':
      entry.channel.enqueueAll(action.files);
      if (entry.channel.status === 'idle') this.#feedNext(channelName);
      break;

    case 'wait_for_input':
      entry.channel.setWaitingForInput(true, {
        timeout: action.timeout,
        default: action.default,
      });
      // Play prompt if present
      if (action.prompt) {
        entry.feeder.playFile(action.prompt);
      }
      // Set timeout for default choice
      if (action.timeout) {
        setTimeout(() => {
          if (entry.runner?.isWaitingForInput) {
            this.sendInput(channelName, null); // triggers default
          }
        }, action.timeout * 1000);
      }
      break;

    case 'stop':
      entry.runner = null;
      entry.channel.setProgram(null);
      this.#startAmbient(channelName);
      break;
  }

  this.#broadcast(channelName);
}
```

Also update `#feedNext` to check if a program runner is active and call `runner.advance()` after track ends:

```javascript
#feedNext(name) {
  if (!this.#channels.has(name)) return;
  const { channel, feeder, runner } = this.#channels.get(name);

  // If a program is running, advance it
  if (runner && !runner.isFinished && !runner.isWaitingForInput) {
    const action = runner.advance();
    this.#executeAction(name, action);
    return;
  }

  // Otherwise pull from queue
  const next = channel.dequeue();
  if (next) {
    channel.setCurrentTrack(next);
    feeder.playFile(next);
    this.#broadcast(name);
  } else {
    this.#startAmbient(name);
  }
}
```

- [ ] **Step 2: Update API router program endpoints**

In `backend/src/4_api/v1/routers/livestream.mjs`, replace the placeholder program endpoints:

```javascript
router.post('/:channel/program/start', asyncHandler(async (req, res) => {
  const { program } = req.body;
  if (!program) return res.status(400).json({ error: 'program name is required' });

  try {
    // Program definitions would come from livestream.yml config
    // For now, accept inline definition or name lookup
    const programDef = req.body.definition || { type: 'yaml', path: `${program}.yml` };
    await channelManager.startProgram(req.params.channel, program, programDef);
    res.json(channelManager.getStatus(req.params.channel));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

router.post('/:channel/program/stop', (req, res) => {
  try {
    channelManager.stopProgram(req.params.channel);
    res.json(channelManager.getStatus(req.params.channel));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Run all livestream tests**

Run: `npx vitest run tests/unit/livestream/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/livestream/ChannelManager.mjs backend/src/4_api/v1/routers/livestream.mjs
git commit -m "feat(livestream): wire ProgramRunner into ChannelManager — program start/stop/input"
```

---

## Task 10: Frontend — Channel List + DJ Board

**Files:**
- Create: `frontend/src/modules/Media/LiveStream/ChannelList.jsx`
- Create: `frontend/src/modules/Media/LiveStream/DJBoard.jsx`
- Create: `frontend/src/modules/Media/LiveStream/ProgramStatus.jsx`
- Create: `frontend/src/modules/Media/LiveStream/LiveStream.scss`
- Modify: `frontend/src/Apps/MediaApp.jsx` — add `/media/livestream` route

- [ ] **Step 1: Create LiveStream.scss**

```scss
// frontend/src/modules/Media/LiveStream/LiveStream.scss

.livestream-channels {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
  overflow-y: auto;

  .channel-card {
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;

    &:hover { background: rgba(255, 255, 255, 0.1); }

    .channel-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;

      .channel-name { font-size: 1.1rem; font-weight: 600; }
      .channel-status { font-size: 0.8rem; opacity: 0.6; }
      .channel-track { font-size: 0.8rem; opacity: 0.8; }
    }

    .channel-listeners {
      font-size: 0.8rem;
      opacity: 0.5;
    }

    .channel-delete {
      background: none;
      border: none;
      color: rgba(255, 80, 80, 0.7);
      cursor: pointer;
      font-size: 1rem;
      padding: 0.25rem 0.5rem;
      &:hover { color: rgba(255, 80, 80, 1); }
    }
  }

  .create-channel {
    display: flex;
    gap: 0.5rem;
    align-items: center;

    input {
      flex: 1;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 0.5rem 0.75rem;
      color: inherit;
      font-size: 0.9rem;
    }

    button {
      background: rgba(100, 180, 255, 0.2);
      border: 1px solid rgba(100, 180, 255, 0.3);
      border-radius: 8px;
      padding: 0.5rem 1rem;
      color: inherit;
      cursor: pointer;
      &:hover { background: rgba(100, 180, 255, 0.3); }
    }
  }
}

.djboard {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem;
  height: 100%;
  overflow: hidden;

  .djboard-soundboard {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;

    .soundboard-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    .sound-btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 1rem;
      color: inherit;
      font-size: 0.9rem;
      cursor: pointer;
      text-align: center;
      transition: background 0.1s ease;
      &:hover { background: rgba(255, 255, 255, 0.15); }
      &:active { background: rgba(100, 180, 255, 0.3); }
    }

    .transport {
      display: flex;
      gap: 0.5rem;

      button {
        flex: 1;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 0.6rem;
        color: inherit;
        cursor: pointer;
        font-size: 0.85rem;
        &:hover { background: rgba(255, 255, 255, 0.1); }
      }
    }
  }

  .djboard-queue {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;

    .now-playing {
      background: rgba(100, 180, 255, 0.12);
      border-radius: 8px;
      padding: 0.75rem;
      font-size: 0.85rem;

      .track-name { font-weight: 600; }
    }

    .queue-item {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      display: flex;
      justify-content: space-between;
      align-items: center;

      .remove-btn {
        background: none;
        border: none;
        color: rgba(255, 80, 80, 0.6);
        cursor: pointer;
        &:hover { color: rgba(255, 80, 80, 1); }
      }
    }
  }
}

.program-status {
  background: rgba(180, 130, 255, 0.1);
  border: 1px solid rgba(180, 130, 255, 0.2);
  border-radius: 8px;
  padding: 0.75rem;
  margin-top: 0.5rem;

  .program-name { font-weight: 600; font-size: 0.85rem; }
  .program-state { font-size: 0.8rem; opacity: 0.7; margin-top: 0.25rem; }

  .input-buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;

    button {
      flex: 1;
      background: rgba(180, 130, 255, 0.2);
      border: 1px solid rgba(180, 130, 255, 0.3);
      border-radius: 8px;
      padding: 0.5rem;
      color: inherit;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      &:hover { background: rgba(180, 130, 255, 0.35); }
    }
  }
}

.back-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.25rem 0;
  margin-bottom: 0.5rem;
  &:hover { color: rgba(255, 255, 255, 0.9); }
}
```

- [ ] **Step 2: Create ProgramStatus component**

```jsx
// frontend/src/modules/Media/LiveStream/ProgramStatus.jsx
import React from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

const ProgramStatus = ({ channel, status, onUpdate }) => {
  if (!status.activeProgram) return null;

  const sendInput = async (choice) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/input/${choice}`, { method: 'POST' });
    onUpdate?.();
  };

  return (
    <div className="program-status">
      <div className="program-name">Program: {status.activeProgram}</div>
      {status.waitingForInput && (
        <>
          <div className="program-state">Waiting for input...</div>
          <div className="input-buttons">
            {['a', 'b', 'c', 'd'].map(choice => (
              <button key={choice} onClick={() => sendInput(choice)}>
                {choice.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ProgramStatus;
```

- [ ] **Step 3: Create DJBoard component**

```jsx
// frontend/src/modules/Media/LiveStream/DJBoard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import ProgramStatus from './ProgramStatus.jsx';

const DJBoard = ({ channel, onBack }) => {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    const data = await DaylightAPI(`/api/v1/livestream/${channel}`);
    setStatus(data);
  }, [channel]);

  useEffect(() => { refresh(); }, [refresh]);

  // WebSocket for live updates
  useEffect(() => {
    // Subscribe to livestream:{channel} topic for real-time updates
    // Uses existing WS infrastructure — will update status on message
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'bus_command', action: 'subscribe', topics: [`livestream:${channel}`] }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.topic === `livestream:${channel}`) {
          setStatus(msg);
        }
      } catch {}
    };
    return () => ws.close();
  }, [channel]);

  const queueFile = async () => {
    const file = prompt('File path:');
    if (file) {
      await DaylightAPI(`/api/v1/livestream/${channel}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [file] }),
      });
      refresh();
    }
  };

  const forcePlay = async (file) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/force`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file }),
    });
    refresh();
  };

  const skip = async () => {
    await DaylightAPI(`/api/v1/livestream/${channel}/skip`, { method: 'POST' });
    refresh();
  };

  const stop = async () => {
    await DaylightAPI(`/api/v1/livestream/${channel}/stop`, { method: 'POST' });
    refresh();
  };

  const removeFromQueue = async (index) => {
    await DaylightAPI(`/api/v1/livestream/${channel}/queue/${index}`, { method: 'DELETE' });
    refresh();
  };

  if (!status) return <div className="djboard">Loading...</div>;

  const soundboard = status.soundboard || [];

  return (
    <div className="djboard">
      <div className="djboard-soundboard">
        <button className="back-btn" onClick={onBack}>Back to channels</button>

        {soundboard.length > 0 && (
          <div className="soundboard-grid">
            {soundboard.map((btn, i) => (
              <button
                key={i}
                className="sound-btn"
                onClick={() => btn.force ? forcePlay(btn.file) : queueFile(btn.file)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        <div className="transport">
          <button onClick={stop}>Stop</button>
          <button onClick={skip}>Skip</button>
          <button onClick={queueFile}>+ Add</button>
        </div>

        <ProgramStatus channel={channel} status={status} onUpdate={refresh} />
      </div>

      <div className="djboard-queue">
        {status.currentTrack ? (
          <div className="now-playing">
            <div className="track-name">Now: {status.currentTrack.split('/').pop()}</div>
          </div>
        ) : (
          <div className="now-playing">
            <div className="track-name">Idle — ambient</div>
          </div>
        )}

        {status.queue?.map((file, i) => (
          <div key={i} className="queue-item">
            <span>{i + 1}. {file.split('/').pop()}</span>
            <button className="remove-btn" onClick={() => removeFromQueue(i)}>x</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DJBoard;
```

- [ ] **Step 4: Create ChannelList component**

```jsx
// frontend/src/modules/Media/LiveStream/ChannelList.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import DJBoard from './DJBoard.jsx';
import './LiveStream.scss';

const ChannelList = () => {
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    const data = await DaylightAPI('/api/v1/livestream/channels');
    setChannels(data.channels || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createChannel = async () => {
    if (!newName.trim()) return;
    await DaylightAPI('/api/v1/livestream/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName('');
    refresh();
  };

  const deleteChannel = async (name, e) => {
    e.stopPropagation();
    await DaylightAPI(`/api/v1/livestream/${name}`, { method: 'DELETE' });
    refresh();
  };

  if (selectedChannel) {
    return <DJBoard channel={selectedChannel} onBack={() => { setSelectedChannel(null); refresh(); }} />;
  }

  return (
    <div className="livestream-channels">
      {channels.map(ch => (
        <div key={ch.name} className="channel-card" onClick={() => setSelectedChannel(ch.name)}>
          <div className="channel-info">
            <div className="channel-name">{ch.name}</div>
            <div className="channel-status">{ch.status}{ch.activeProgram ? ` — ${ch.activeProgram}` : ''}</div>
            {ch.currentTrack && <div className="channel-track">{ch.currentTrack.split('/').pop()}</div>}
          </div>
          <div className="channel-listeners">{ch.listenerCount} listeners</div>
          <button className="channel-delete" onClick={(e) => deleteChannel(ch.name, e)}>Delete</button>
        </div>
      ))}

      <div className="create-channel">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New channel name..."
          onKeyDown={e => e.key === 'Enter' && createChannel()}
        />
        <button onClick={createChannel}>Create</button>
      </div>
    </div>
  );
};

export default ChannelList;
```

- [ ] **Step 5: Add livestream route to MediaApp**

In `frontend/src/Apps/MediaApp.jsx`, add the livestream panel. Find the `activePanel` useMemo and add a case:

```javascript
// In the activePanel useMemo, add:
if (location.pathname.startsWith('/media/livestream')) return 'livestream';
```

Add the import at the top:
```javascript
import ChannelList from '../modules/Media/LiveStream/ChannelList.jsx';
```

Add the panel in the JSX alongside other panels:
```jsx
<div className={`media-panel media-panel--livestream ${activePanel === 'livestream' ? 'media-panel--active' : ''}`}>
  <ChannelList />
</div>
```

The exact insertion points depend on the current MediaApp structure — follow the same pattern as the existing search/browser/player panels.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Media/LiveStream/ frontend/src/Apps/MediaApp.jsx
git commit -m "feat(livestream): add DJ board frontend — channel list, soundboard, queue, program status"
```

---

## Task 11: End-to-End Smoke Test

**Files:** None created — manual verification

- [ ] **Step 1: Verify server starts cleanly**

```bash
ss -tlnp | grep 3112
# Start if needed: node backend/index.js &
curl -s http://localhost:3112/api/v1/livestream/channels | jq
```

Expected: `{"channels":[]}`

- [ ] **Step 2: Create a channel and test queue**

```bash
# Create channel
curl -s -X POST http://localhost:3112/api/v1/livestream/channels \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","bitrate":96}' | jq

# Queue a file (use an actual MP3 from the media volume)
curl -s -X POST http://localhost:3112/api/v1/livestream/test/queue \
  -H 'Content-Type: application/json' \
  -d '{"files":["/path/to/any/audio.mp3"]}' | jq

# Check status
curl -s http://localhost:3112/api/v1/livestream/test | jq
```

- [ ] **Step 3: Test the audio stream**

```bash
# Connect to stream (should receive AAC data)
curl -s -N http://localhost:3112/api/v1/livestream/test/listen --output /tmp/stream-test.aac &
STREAM_PID=$!
sleep 5
kill $STREAM_PID

# Verify we got audio data
ls -la /tmp/stream-test.aac
file /tmp/stream-test.aac
```

Expected: File should be non-empty and identified as AAC audio.

- [ ] **Step 4: Test force-play and skip**

```bash
curl -s -X POST http://localhost:3112/api/v1/livestream/test/force \
  -H 'Content-Type: application/json' \
  -d '{"file":"/path/to/another/audio.mp3"}' | jq

curl -s -X POST http://localhost:3112/api/v1/livestream/test/skip | jq
```

- [ ] **Step 5: Test button input endpoint**

```bash
curl -s -X POST http://localhost:3112/api/v1/livestream/test/input/a | jq
# Expected: {"ok":true,"channel":"test","choice":"a"}

curl -s -X POST http://localhost:3112/api/v1/livestream/test/input/x | jq
# Expected: 400 error — invalid choice
```

- [ ] **Step 6: Cleanup test channel**

```bash
curl -s -X DELETE http://localhost:3112/api/v1/livestream/test | jq
```

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix(livestream): smoke test fixes"
```

---

## Deferred to Phase 2

- **JS Program Runner** — `async function({ channel, tts, clock, api, input })` execution context. Requires sandboxing, TTS integration, and internal API proxy. Build once the YAML engine is proven.
- **Soundboard config persistence** — soundboard buttons currently defined in channel config but not yet editable from the DJ board UI.
- **Config-driven channel auto-start** — reading `livestream.yml` on server boot to auto-create channels. Currently channels are created via API only.

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | StreamChannel entity | 16 unit tests |
| 2 | FFmpegStreamAdapter | 8 unit tests |
| 3 | SourceFeeder | 7 unit tests |
| 4 | IAudioAssetResolver + TTSAssetResolver | 7 unit tests |
| 5 | ChannelManager | 10 unit tests |
| 6 | API Router | — (integration via Task 11) |
| 7 | Bootstrap wiring + manifest | — (verified by server start) |
| 8 | ProgramRunner | 8 unit tests |
| 9 | Wire ProgramRunner into ChannelManager | — (extends Task 5 tests) |
| 10 | Frontend DJ board | — (manual/visual) |
| 11 | End-to-end smoke test | Manual verification |
