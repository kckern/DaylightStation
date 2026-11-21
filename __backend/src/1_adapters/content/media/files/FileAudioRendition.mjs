import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { getFileStats, resolveRealPath } from '#system/utils/FileIO.mjs';

const formats = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,flv,asf,mxf';
const probeCache = new Map();
const maxProbeEntries = 512;
const maxStreams = 4;
let activeStreams = 0;

function probe(file) {
  return new Promise(resolve => {
    execFile('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', formats,
      '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1', '-i', file,
    ], { timeout: 3500, maxBuffer: 4096 }, (error, stdout) =>
      resolve(error ? null : stdout.trim() !== ''));
  });
}

export async function resolveFileAudioSource(mediaBasePath, filePath) {
  if (!filePath) return null;
  const root = resolveRealPath(mediaBasePath);
  const file = resolveRealPath(filePath);
  if (!root || !file || !file.startsWith(root + path.sep)) return null;
  let stat;
  try { stat = getFileStats(file); } catch { return null; }
  if (!stat?.isFile()) return null;

  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!probeCache.has(key)) {
    if (probeCache.size >= maxProbeEntries) probeCache.delete(probeCache.keys().next().value);
    probeCache.set(key, probe(file).then(result => {
      if (result === null) probeCache.delete(key);
      return result;
    }));
  }
  return await probeCache.get(key) ? file : null;
}

export function openFileAudioStream(file, signal) {
  return openAudioStream(file, 'file,pipe', signal);
}

/** Give FFmpeg a seekable view of one authenticated provider object. */
export async function openProviderAudioStream(openInput, signal) {
  if (activeStreams >= maxStreams || signal?.aborted) return null;
  const inputPath = '/' + randomUUID();
  const server = createServer(async (req, res) => {
    const range = req.headers.range;
    if (req.url !== inputPath || !['GET', 'HEAD'].includes(req.method)
        || (range !== undefined && !/^bytes=\d+-\d*$/.test(range))) {
      res.writeHead(400).end();
      return;
    }
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const upstream = await openInput({
        range, method: req.method,
        signal: controller.signal,
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        res.writeHead(502).end();
        return;
      }
      const headers = {};
      for (const key of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(key);
        if (value) headers[key] = value;
      }
      res.writeHead(upstream.status, headers);
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed) res.writeHead(502).end();
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const stop = () => {
    server.closeAllConnections();
    server.close();
  };
  const stream = openAudioStream(`http://127.0.0.1:${server.address().port}${inputPath}`, 'http,tcp,pipe', signal);
  if (stream) stream.once('close', stop);
  else stop();
  return stream;
}

function openAudioStream(input, protocols, signal) {
  if (activeStreams >= maxStreams || signal?.aborted) return null;
  const ffmpeg = spawn('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-protocol_whitelist', protocols, '-format_whitelist', formats,
    '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', '-f', 'mp3', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'], signal });
  activeStreams += 1;
  const audio = new PassThrough();
  const startTimeout = setTimeout(() => ffmpeg.kill(), 10_000);
  ffmpeg.stdout.once('readable', () => clearTimeout(startTimeout));
  ffmpeg.stdout.pipe(audio, { end: false });
  ffmpeg.once('error', error => audio.destroy(error));
  ffmpeg.once('close', code => {
    clearTimeout(startTimeout);
    activeStreams -= 1;
    if (code === 0) audio.end();
    else audio.destroy(new Error('Audio encoding failed'));
  });
  audio.once('close', () => {
    if (ffmpeg.exitCode === null) ffmpeg.kill();
  });
  return audio;
}
