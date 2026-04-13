// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';

// Mock child_process before import
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
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

      const chunks = [];
      client.on('data', (chunk) => chunks.push(chunk));
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
