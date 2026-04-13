// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
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
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(chunks.length).toBeGreaterThan(0);
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
