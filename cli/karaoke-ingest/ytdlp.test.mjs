import { describe, it, expect } from 'vitest';
import { buildDownloadArgv, buildEmbedArgv, search } from './ytdlp.mjs';

describe('buildDownloadArgv', () => {
  it('passes url as the final positional and never shell-interpolates', () => {
    const argv = buildDownloadArgv({ url: 'https://youtu.be/abc', outPath: '/m/out.mp4', formatSort: 'res:1080', mergeFormat: 'mp4' });
    expect(argv).toEqual([
      '--js-runtimes', 'node', '--no-warnings', '--no-playlist',
      '-S', 'res:1080', '--merge-output-format', 'mp4', '-o', '/m/out.mp4', 'https://youtu.be/abc',
    ]);
  });
});

describe('buildEmbedArgv', () => {
  it('remuxes with copy codecs and sets title/comment metadata', () => {
    const argv = buildEmbedArgv({ inPath: '/m/a.tmp.mp4', outPath: '/m/a.mp4', title: 'My Way (Sinatra)', comment: 'note' });
    expect(argv).toEqual([
      '-y', '-i', '/m/a.tmp.mp4', '-map', '0', '-c', 'copy',
      '-metadata', 'title=My Way (Sinatra)', '-metadata', 'comment=note',
      '-movflags', '+faststart', '/m/a.mp4',
    ]);
  });
});

describe('search', () => {
  it('maps yt-dlp flat-playlist JSON entries to Candidate objects', async () => {
    const fakeExec = async () => ({
      stdout: JSON.stringify({ entries: [
        { id: 'v1', title: 'A Karaoke', channel: 'Sing King', view_count: 10, duration: 200 },
        { id: 'v2', title: 'B Karaoke', uploader: 'KaraFun', view_count: 5, duration: 210 },
      ] }),
    });
    const out = await search('q', { searchCount: 12, exec: fakeExec });
    expect(out).toEqual([
      { id: 'v1', title: 'A Karaoke', channel: 'Sing King', viewCount: 10, duration: 200 },
      { id: 'v2', title: 'B Karaoke', channel: 'KaraFun', viewCount: 5, duration: 210 },
    ]);
  });
});
