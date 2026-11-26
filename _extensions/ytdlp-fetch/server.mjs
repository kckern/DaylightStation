#!/usr/bin/env node
/**
 * ytdlp-fetch — a small HTTP service that fetches one video with yt-dlp and
 * serves the file, for DaylightStation's share router.
 *
 * It runs in the yt-dlp sidecar, which shares the VPN container's network
 * namespace (all egress through the VPN) and has the PO-token plugin and its
 * provider beside it. Files stay in this service's own storage, outside any
 * synced folder; the app streams them through its own route.
 *
 *   GET    /health                 { ok, ytdlp, running, queued, jobs }
 *   POST   /fetch                  { name, url, maxHeight? } -> the job (202 new, 200 existing)
 *   GET    /fetch/:name            { name, state, progress, title, duration, size, error }
 *   GET    /fetch/:name/file       the mp4, with Range support (HEAD too); 409 until ready
 *   DELETE /fetch/:name            stop it and delete its file
 *
 *   state: queued | downloading | ready | failed
 *
 * A name is `s` and 12 hex digits (the app's share job id). A URL must be https
 * on a host in ALLOWED_HOSTS. yt-dlp gets an argument list, never a shell.
 *
 * Env: PORT (8790), FETCH_DIR (/fetch), MAX_RUNNING (2), MAX_AGE_HOURS (6),
 *      STALL_SECONDS (90), MAX_HEIGHT (1080), TIMEOUT_SECONDS (1800),
 *      MAX_DURATION_SECONDS (10800), MAX_FILESIZE (6G),
 *      ALLOWED_HOSTS (YouTube hosts), YTDLP (yt-dlp)
 *
 * Reference: __docs/reference/core/share.md (the fetch service)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PORT = Number(process.env.PORT || 8790);
const DIR = process.env.FETCH_DIR || '/fetch';
const MAX_RUNNING = Number(process.env.MAX_RUNNING || 2);
const MAX_AGE_MS = Number(process.env.MAX_AGE_HOURS || 6) * 3600_000;
const STALL_MS = Number(process.env.STALL_SECONDS || 90) * 1000;
const TIMEOUT_MS = Number(process.env.TIMEOUT_SECONDS || 1800) * 1000;
const DEFAULT_HEIGHT = Number(process.env.MAX_HEIGHT || 1080);
const YTDLP = process.env.YTDLP || 'yt-dlp';
const MAX_DURATION_S = Number(process.env.MAX_DURATION_SECONDS || 3 * 3600);
const MAX_FILESIZE = process.env.MAX_FILESIZE || '6G';
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS
  || 'www.youtube.com,youtube.com,m.youtube.com,music.youtube.com,youtu.be')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const NAME = /^s[0-9a-f]{12}$/;
const PROGRESS = 'fetch-progress';

const jobs = new Map();
const queue = [];
let running = 0;

const log = (event, data = {}) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
const fileOf = (name) => path.join(DIR, `${name}.mp4`);
const metaOf = (name) => path.join(DIR, `${name}.json`);

let ytdlpVersion = null;
try { ytdlpVersion = execFileSync(YTDLP, ['--version'], { encoding: 'utf8' }).trim(); } catch { ytdlpVersion = null; }

fs.mkdirSync(DIR, { recursive: true });

/** Files fetched before a restart are still ready to serve. */
function restore() {
  for (const entry of fs.readdirSync(DIR)) {
    const m = /^(s[0-9a-f]{12})\.mp4$/.exec(entry);
    if (!m) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaOf(m[1]), 'utf8')); } catch { meta = {}; }
    const size = fs.statSync(fileOf(m[1])).size;
    jobs.set(m[1], { name: m[1], state: 'ready', progress: 1, title: meta.title ?? null, duration: meta.duration ?? null, size, error: null, updatedAt: Date.now() });
  }
  log('restored', { jobs: jobs.size });
}

function view(job) {
  const { name, state, progress, title, duration, size, error } = job;
  return { name, state, progress, title, duration, size, error };
}

function allowedUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch { return null; }
}

function args(url, name, maxHeight) {
  const h = Number(maxHeight) > 0 ? Math.min(2160, Math.round(Number(maxHeight))) : DEFAULT_HEIGHT;
  return [
    '--no-playlist', '--no-warnings', '--newline', '--progress', '--no-part',
    '--concurrent-fragments', '4',
    // Too long or too large: skipped (exit 0, no file) -> failed 'too large', and the app streams it instead.
    '--match-filter', `duration <= ${MAX_DURATION_S}`,
    '--max-filesize', MAX_FILESIZE,
    '-f', `bv*[vcodec^=avc1][height<=${h}]+ba[ext=m4a]/b[ext=mp4][height<=${h}]/bv*[height<=${h}]+ba/b`,
    '--merge-output-format', 'mp4', '--remux-video', 'mp4',
    '--progress-template', `download:${PROGRESS}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.filename)s`,
    '--print', 'after_move:fetch-done|%(title)s|%(duration)s',
    '--no-simulate',
    '-o', path.join(DIR, `${name}.%(ext)s`),
    url,
  ];
}

function cleanup(name) {
  for (const entry of fs.readdirSync(DIR)) {
    if (entry.startsWith(`${name}.`)) { try { fs.unlinkSync(path.join(DIR, entry)); } catch { /* gone */ } }
  }
}

function fail(job, error) {
  if (job.state === 'failed') return;
  job.state = 'failed';
  job.error = String(error || 'failed').slice(0, 300);
  job.updatedAt = Date.now();
  cleanup(job.name);
  log('failed', { name: job.name, error: job.error });
}

function start(job) {
  running += 1;
  job.state = 'downloading';
  job.updatedAt = Date.now();
  const files = [];
  let best = 0;
  let lastMove = Date.now();
  let stderr = '';
  let done = null;
  const child = spawn(YTDLP, args(job.url, job.name, job.maxHeight), { stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  log('start', { name: job.name, maxHeight: job.maxHeight });
  const watchdog = setInterval(() => {
    if (Date.now() - lastMove > STALL_MS) { child.kill('SIGKILL'); fail(job, `no progress for ${STALL_MS / 1000}s`); }
    if (Date.now() - job.startedAt > TIMEOUT_MS) { child.kill('SIGKILL'); fail(job, `timeout after ${TIMEOUT_MS / 1000}s`); }
  }, 5000);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith(`${PROGRESS}|`)) {
        const [, d, t, e, ...f] = line.split('|');
        const file = f.join('|');
        if (file && !files.includes(file)) files.push(file);
        const total = Number(t) > 0 ? Number(t) : Number(e);
        const within = total > 0 ? Math.min(1, Number(d) / total) : 0;
        const [lo, hi] = files.indexOf(file) <= 0 ? [0, 0.9] : [0.9, 1];
        const overall = Math.min(0.99, lo + within * (hi - lo));
        if (overall > best) { best = overall; job.progress = best; lastMove = Date.now(); job.updatedAt = lastMove; }
      } else if (line.startsWith('fetch-done|')) {
        const [, title, duration] = line.split('|');
        done = { title: title && title !== 'NA' ? title : null, duration: Number.isFinite(Number(duration)) ? Number(duration) : null };
        lastMove = Date.now();
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-800); lastMove = Date.now(); });
  child.on('error', (error) => fail(job, error.message));
  child.on('close', (code) => {
    clearInterval(watchdog);
    running -= 1;
    job.child = null;
    if (job.state === 'downloading' && code === 0 && fs.existsSync(fileOf(job.name))) {
      job.state = 'ready';
      job.progress = 1;
      job.title = done?.title ?? null;
      job.duration = done?.duration ?? null;
      job.size = fs.statSync(fileOf(job.name)).size;
      job.updatedAt = Date.now();
      fs.writeFileSync(metaOf(job.name), JSON.stringify({ title: job.title, duration: job.duration }));
      log('ready', { name: job.name, ms: Date.now() - job.startedAt, size: job.size });
    } else if (job.state === 'downloading' && code === 0) {
      fail(job, 'too large or too long to fetch');
    } else if (job.state === 'downloading') {
      fail(job, (stderr.match(/ERROR:[^\n]*/) || [])[0] || `yt-dlp exited ${code}`);
    }
    next();
  });
}

function next() {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift();
    if (job.state === 'queued') start(job);
  }
}

function sweep() {
  const now = Date.now();
  for (const entry of fs.readdirSync(DIR)) {
    const m = /^(s[0-9a-f]{12})\./.exec(entry);
    if (!m) continue;
    const job = jobs.get(m[1]);
    if (job && (job.state === 'downloading' || job.state === 'queued')) continue;
    const file = path.join(DIR, entry);
    try {
      if (now - fs.statSync(file).mtimeMs > MAX_AGE_MS) { fs.unlinkSync(file); jobs.delete(m[1]); log('swept', { file: entry }); }
    } catch { /* gone */ }
  }
  for (const [name, job] of jobs) {
    if (job.state === 'failed' && now - job.updatedAt > MAX_AGE_MS) jobs.delete(name);
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(req, res, job) {
  const file = fileOf(job.name);
  let size;
  try { size = fs.statSync(file).size; } catch { return send(res, 404, { error: 'gone' }); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const base = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, ytdlpVersion ? 200 : 503, { ok: !!ytdlpVersion, ytdlp: ytdlpVersion, running, queued: queue.length, jobs: jobs.size });
    }
    if (parts[0] !== 'fetch') return send(res, 404, { error: 'not found' });
    if (req.method === 'POST' && parts.length === 1) {
      const body = await readJson(req);
      const name = String(body?.name ?? '');
      const target = allowedUrl(body?.url);
      if (!NAME.test(name)) return send(res, 400, { error: 'bad name' });
      if (!target) return send(res, 400, { error: 'url not allowed' });
      const existing = jobs.get(name);
      if (existing && existing.state !== 'failed') return send(res, 200, view(existing));
      const job = { name, url: target, maxHeight: body?.maxHeight, state: 'queued', progress: 0, title: null, duration: null, size: null, error: null, startedAt: Date.now(), updatedAt: Date.now(), child: null };
      jobs.set(name, job);
      queue.push(job);
      log('queued', { name, host: new URL(target).hostname });
      next();
      return send(res, 202, view(job));
    }
    const name = parts[1];
    const job = NAME.test(name || '') ? jobs.get(name) : null;
    if (!job) return send(res, 404, { error: 'unknown' });
    if (parts.length === 2 && req.method === 'GET') return send(res, 200, view(job));
    if (parts.length === 2 && req.method === 'DELETE') {
      job.child?.kill('SIGKILL');
      if (job.state !== 'ready') fail(job, 'cancelled'); else cleanup(name);
      jobs.delete(name);
      return send(res, 200, { ok: true });
    }
    if (parts.length === 3 && parts[2] === 'file' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (job.state !== 'ready') return send(res, 409, { error: 'not ready', state: job.state });
      return serveFile(req, res, job);
    }
    return send(res, 404, { error: 'not found' });
  } catch (error) {
    log('error', { error: error.message });
    if (!res.headersSent) send(res, 500, { error: 'internal' });
    else res.destroy();
  }
});

restore();
sweep();
setInterval(sweep, 30 * 60_000).unref();
server.listen(PORT, () => log('listening', { port: PORT, dir: DIR, ytdlp: ytdlpVersion, maxRunning: MAX_RUNNING }));
