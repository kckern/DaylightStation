// downloadOne: one shared video to an exact path, with real progress.
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('#system/utils/FileIO.mjs', () => ({
  deleteFile: vi.fn(),
  ensureDir: vi.fn(),
  fileExists: vi.fn(() => true),
  getFileStats: vi.fn(() => ({ mtimeMs: 1 })),
  readDirectory: vi.fn(() => []),
}));

const {
  YtDlpAdapter, buildSingleDownloadArgs, parseSingleProgressLine, SingleDownloadProgress,
} = await import('./YtDlpAdapter.mjs');
const FileIO = await import('#system/utils/FileIO.mjs');

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

function fakeSpawn(script) {
  const calls = [];
  const spawn = (bin, argv) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    calls.push({ bin, argv, child });
    setTimeout(() => script(child), 0);
    return child;
  };
  return { spawn, calls };
}

describe('buildSingleDownloadArgs', () => {
  it('passes the URL as the last discrete element and never a shell string', () => {
    const argv = buildSingleDownloadArgs('https://www.youtube.com/watch?v=abc$(rm)', { outputPath: '/m/tmp/share/x.mp4' });
    expect(argv.at(-1)).toBe('https://www.youtube.com/watch?v=abc$(rm)');
    expect(argv).toContain('--progress');
    expect(argv[argv.indexOf('-o') + 1]).toBe('/m/tmp/share/x.%(ext)s');
    expect(argv[argv.indexOf('--merge-output-format') + 1]).toBe('mp4');
  });

  it('caps the height it asks for', () => {
    const argv = buildSingleDownloadArgs('u', { outputPath: '/x.mp4', maxHeight: 720 });
    expect(argv[argv.indexOf('-f') + 1]).toContain('height<=720');
  });

  it('refuses a path that is not an mp4', () => {
    expect(() => buildSingleDownloadArgs('u', { outputPath: '/x.webm' })).toThrow();
  });
});

describe('parseSingleProgressLine', () => {
  it('reads bytes, total and the stream file', () => {
    expect(parseSingleProgressLine('share-progress|500|1000|NA|/t/x.f137.mp4'))
      .toEqual({ downloadedBytes: 500, totalBytes: 1000, file: '/t/x.f137.mp4' });
  });
  it('falls back to the estimate when the total is unknown', () => {
    expect(parseSingleProgressLine('share-progress|5|NA|20|f').totalBytes).toBe(20);
  });
  it('ignores other output', () => {
    expect(parseSingleProgressLine('[download] Destination: x')).toBeNull();
  });
});

describe('SingleDownloadProgress', () => {
  it('maps the video stream then the audio stream and never goes back', () => {
    const p = new SingleDownloadProgress({ firstShare: 0.9 });
    expect(p.update({ downloadedBytes: 50, totalBytes: 100, file: 'v' })).toBeCloseTo(0.45);
    expect(p.update({ downloadedBytes: 100, totalBytes: 100, file: 'v' })).toBeCloseTo(0.9);
    expect(p.update({ downloadedBytes: 0, totalBytes: 10, file: 'a' })).toBeCloseTo(0.9);
    expect(p.update({ downloadedBytes: 10, totalBytes: 10, file: 'a' })).toBeCloseTo(0.99);
  });
});

describe('YtDlpAdapter.downloadOne', () => {
  it('reports progress and resolves downloaded with the title', async () => {
    const { spawn, calls } = fakeSpawn((child) => {
      child.stdout.emit('data', Buffer.from('share-progress|10|100|NA|v\nshare-progress|100|100|NA|v\n'));
      child.stdout.emit('data', Buffer.from('share-done|/m/x.mp4|A title|42\n'));
      child.emit('close', 0);
    });
    const ticks = [];
    const adapter = new YtDlpAdapter({ logger: quiet(), spawn });
    const result = await adapter.downloadOne('https://www.youtube.com/watch?v=aaaaaaaaaaa', {
      outputPath: '/m/x.mp4', onProgress: (f) => ticks.push(f),
    });
    expect(calls[0].bin).toBe('yt-dlp');
    expect(result).toEqual({ kind: 'downloaded', filePath: '/m/x.mp4', title: 'A title', duration: 42 });
    expect(ticks[0]).toBeCloseTo(0.09);
    expect(ticks.at(-1)).toBeCloseTo(0.9);
  });

  it('fails with yt-dlp\'s own error line and removes any partial file', async () => {
    FileIO.deleteFile.mockClear();
    const { spawn } = fakeSpawn((child) => {
      child.stderr.emit('data', Buffer.from('ERROR: [youtube] abc: Video unavailable\n'));
      child.emit('close', 1);
    });
    const adapter = new YtDlpAdapter({ logger: quiet(), spawn });
    const result = await adapter.downloadOne('u', { outputPath: '/m/x.mp4' });
    expect(result).toEqual({ kind: 'failed', error: 'ERROR: [youtube] abc: Video unavailable' });
    expect(FileIO.deleteFile).toHaveBeenCalledWith('/m/x.mp4');
  });

  it('kills yt-dlp and fails when cancelled', async () => {
    const ctrl = new AbortController();
    const { spawn, calls } = fakeSpawn(() => {});
    const adapter = new YtDlpAdapter({ logger: quiet(), spawn });
    const pending = adapter.downloadOne('u', { outputPath: '/m/x.mp4', signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    expect(await pending).toEqual({ kind: 'failed', error: 'cancelled' });
    expect(calls[0].child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
