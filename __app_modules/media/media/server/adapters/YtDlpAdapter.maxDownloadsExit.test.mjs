// yt-dlp exits 101 when --max-downloads is reached — i.e. after the one
// download it was asked for succeeded. That is success, not a failed attempt
// (every fresh-video source logged downloadFailed nightly while its file landed).
import { describe, it, expect, vi } from 'vitest';
import { promisify } from 'node:util';

const ytdlpExitCode = { value: 101 };
vi.mock('child_process', () => {
  const exec = vi.fn((cmd, cb) => {
    if (String(cmd).includes('yt-dlp')) {
      const code = ytdlpExitCode.value;
      setTimeout(() => cb(code ? Object.assign(new Error(`Command failed: ${cmd}`), { code }) : null, '', ''), 0);
    }
    return { kill() {}, on() {} };
  });
  exec[promisify.custom] = async () => ({ stdout: 'hevc\n', stderr: '' });
  const execFile = vi.fn();
  return { default: { exec, execFile }, exec, execFile };
});
vi.mock('#system/utils/FileIO.mjs', () => ({
  deleteFile: vi.fn(),
  ensureDir: vi.fn(),
  fileExists: vi.fn(() => true),
  getFileStats: vi.fn(() => ({ mtimeMs: 1 })),
  readDirectory: vi.fn(() => ['20261029.mp4']),
}));

const { YtDlpAdapter } = await import('./YtDlpAdapter.mjs');
const source = { provider: 'tldr_global', sourceRef: { platform: 'youtube', collectionType: 'channel', locator: 'UC-uhvujip5deVcEtLxnW8qg' } };
const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

describe('YtDlpAdapter.downloadLatest — exit 101', () => {
  it('treats "max downloads reached" as a successful download on the first attempt', async () => {
    ytdlpExitCode.value = 101;
    const log = logger();
    const out = await new YtDlpAdapter({ downloadRoot: '/news', logger: log }).downloadLatest(source, { timeoutMs: 5000 });
    expect(out).toEqual({ kind: 'downloaded', assetId: 'tldr_global:20261029', uploadDate: '20261029' });
    expect(log.warn).not.toHaveBeenCalledWith('ytdlp.downloadError', expect.anything());
  }, 15000);

  it('any other non-zero exit is still a failed attempt', async () => {
    ytdlpExitCode.value = 1;
    const log = logger();
    const out = await new YtDlpAdapter({ downloadRoot: '/news', logger: log }).downloadLatest(source, { timeoutMs: 5000 });
    expect(out.kind).toBe('failed');
  }, 15000);
});
