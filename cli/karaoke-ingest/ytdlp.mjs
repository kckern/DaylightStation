import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildSearchArgv } from './query.mjs';

const defaultExec = promisify(execFile);
const YTDLP = 'yt-dlp';
const FFMPEG = 'ffmpeg';
const MAX_BUFFER = 64 * 1024 * 1024;

export function buildDownloadArgv({ url, outPath, formatSort, mergeFormat }) {
  return [
    '--js-runtimes', 'node', '--no-warnings', '--no-playlist',
    '-S', formatSort, '--merge-output-format', mergeFormat, '-o', outPath, url,
  ];
}

export function buildEmbedArgv({ inPath, outPath, title, comment }) {
  return [
    '-y', '-i', inPath, '-map', '0', '-c', 'copy',
    '-metadata', `title=${title}`, '-metadata', `comment=${comment}`,
    '-movflags', '+faststart', outPath,
  ];
}

function mapEntry(e) {
  return {
    id: e.id,
    title: e.title || '',
    channel: e.channel || e.uploader || '',
    viewCount: e.view_count || 0,
    duration: e.duration || 0,
  };
}

export async function search(query, { searchCount, exec = defaultExec } = {}) {
  const { stdout } = await exec(YTDLP, buildSearchArgv(query, { searchCount }), { maxBuffer: MAX_BUFFER });
  const info = JSON.parse(stdout);
  const entries = Array.isArray(info.entries) ? info.entries : [];
  return entries.filter((e) => e && e.id).map(mapEntry);
}

export async function download({ url, outPath, formatSort, mergeFormat, exec = defaultExec }) {
  await exec(YTDLP, buildDownloadArgv({ url, outPath, formatSort, mergeFormat }), { maxBuffer: MAX_BUFFER });
}

export async function embed({ inPath, outPath, title, comment, exec = defaultExec }) {
  await exec(FFMPEG, buildEmbedArgv({ inPath, outPath, title, comment }), { maxBuffer: MAX_BUFFER });
}
