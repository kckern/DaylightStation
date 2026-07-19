/**
 * Reolink HTTP API client — camera and NVR source profiles behind one interface.
 *
 * The two sources differ in ways that are easy to get wrong:
 *
 *   camera  search records carry `name`; download is a single call by that name.
 *   nvr     search records have NO `name` (they carry `PlaybackTime` instead);
 *           download is two steps: NvrDownload -> generated fragment name,
 *           then Download by that name.
 *
 * Auth: query-parameter user/password ONLY. Token auth via cmd=Login returns
 * "please login first" on NvrDownload, and cmd=Playback returns 403 regardless.
 * Do not reintroduce the token path.
 */

import https from 'https';
import path from 'path';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { rm, rename, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';

/**
 * Normalize a search `name` into what cmd=Download accepts.
 *
 * The two cameras disagree on this, and only one of them is obvious:
 *   driveway (F760P):  /mnt/sda/Mp4Record/2026-07-17/RecS0A_...  (absolute)
 *   doorbell (D340W):  Mp4Record/2026-07-17/RecS07_...           (relative)
 *
 * Download only accepts the relative form, so testing against the doorbell
 * alone hides a total failure on the driveway.
 */
export function toDownloadSource(name) {
  return String(name).replace(/^\/mnt\/sd[a-z]*\//, '');
}

const AGENT = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export class ReolinkClient {
  #host;
  #auth;
  #logger;

  constructor({ host, username, password, logger = console }) {
    this.#host = host;
    this.#auth = { user: username, password };
    this.#logger = logger;
  }

  #url(params) {
    return `https://${this.#host}/cgi-bin/api.cgi?` + new URLSearchParams({ ...params, ...this.#auth });
  }

  /**
   * POST via raw https rather than fetch: these devices serve self-signed
   * certificates, and undici (Node's fetch) offers no per-request way to
   * accept them without mutating global TLS state.
   */
  async #postJson(cmd, body, { timeoutMs = 45000 } = {}) {
    const payload = JSON.stringify(body);
    const raw = await new Promise((resolve, reject) => {
      const req = https.request(
        this.#url({ cmd }),
        {
          method: 'POST',
          agent: AGENT,
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`${cmd} HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`${cmd} timeout after ${timeoutMs}ms`));
      });
      req.end(payload);
    });

    const entry = JSON.parse(raw)[0];
    if (entry?.code !== 0) {
      throw new Error(`${cmd} failed: ${entry?.error?.detail ?? 'unknown'} (rspCode ${entry?.error?.rspCode})`);
    }
    return entry.value;
  }

  /**
   * Search recordings for a local calendar day.
   * @returns {Array} raw Reolink File records (shape differs by source — see header)
   */
  async search({ channel, day, streamType = 'sub' }) {
    const [year, mon, dayNum] = day.split('-').map(Number);
    const value = await this.#postJson('Search', [
      {
        cmd: 'Search',
        action: 0,
        param: {
          Search: {
            channel,
            onlyStatus: 0,
            streamType,
            StartTime: { year, mon, day: dayNum, hour: 0, min: 0, sec: 0 },
            EndTime: { year, mon, day: dayNum, hour: 23, min: 59, sec: 59 },
          },
        },
      },
    ]);
    return value?.SearchResult?.File ?? [];
  }

  /**
   * Which days in a month have recordings. Cheap — used to avoid attempting
   * days the device never recorded.
   * @returns {number[]} day-of-month numbers
   */
  async coverage({ channel, year, mon, streamType = 'sub' }) {
    const value = await this.#postJson('Search', [
      {
        cmd: 'Search',
        action: 1,
        param: {
          Search: {
            channel,
            onlyStatus: 1,
            streamType,
            StartTime: { year, mon, day: 1, hour: 0, min: 0, sec: 0 },
            EndTime: { year, mon, day: 31, hour: 23, min: 59, sec: 59 },
          },
        },
      },
    ]);
    const days = [];
    for (const status of value?.SearchResult?.Status ?? []) {
      [...(status.table ?? '')].forEach((flag, i) => {
        if (flag === '1') days.push(i + 1);
      });
    }
    return days;
  }

  /**
   * NVR only: resolve a time range to a downloadable fragment.
   *
   * NOTE: the returned fileName encodes UTC, while the request times are local.
   * Never parse the fragment name as local time.
   */
  async nvrResolveFragment({ channel, start, end, streamType = 'sub' }) {
    const value = await this.#postJson('NvrDownload', [
      {
        cmd: 'NvrDownload',
        action: 0,
        param: {
          NvrDownload: {
            channel,
            iLogicChannel: 0,
            streamType,
            StartTime: toReolinkTime(start),
            EndTime: toReolinkTime(end),
          },
        },
      },
    ]);
    const file = value?.fileList?.[0];
    if (!file) throw new Error('NvrDownload returned no fragment');
    return { name: file.fileName, sizeBytes: Number(file.fileSize) };
  }

  /**
   * Stream a named recording to disk, retrying transient failures.
   *
   * The NVR is serving live recording for both cameras while we pull from it,
   * and under sustained load it returns 503. Without retries a single one kills
   * the whole run — a 40-hour backfill died on one 503 after several hours.
   * Backoff is generous because the remedy is simply to let the device breathe.
   */
  async download({ source, destPath, timeoutMs = 300000, retries = 4, backoffMs = 5000 }) {
    return withRetry(() => this.#downloadOnce({ source, destPath, timeoutMs }), {
      retries,
      backoffMs,
      onRetry: (attempt, waitMs, err) =>
        this.#logger.warn?.('camera.download.retry', {
          source, attempt, of: retries, waitMs, error: err.message,
        }),
    });
  }

  async #downloadOnce({ source, destPath, timeoutMs }) {
    const rel = toDownloadSource(source);
    const url = this.#url({ cmd: 'Download', source: rel, output: path.basename(rel) });
    return new Promise((resolve, reject) => {
      const req = https.get(url, { agent: AGENT, timeout: timeoutMs }, async (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download HTTP ${res.statusCode} for ${source}`));
          return;
        }
        try {
          await pipeline(res, createWriteStream(destPath));
          resolve(Number(res.headers['content-length'] ?? 0));
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Download timeout for ${source}`));
      });
    });
  }
}

/**
 * Run an operation, retrying transient failures with exponential backoff.
 *
 * Extracted so the policy is testable without touching the network — the
 * behaviour it guards (one 503 killing a multi-hour backfill) is exactly the
 * kind that only shows up hours into a run.
 */
export async function withRetry(fn, { retries = 4, backoffMs = 5000, onRetry = null, sleep = null } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = backoffMs * Math.pow(2, attempt);
      onRetry?.(attempt + 1, delay, err);
      await wait(delay);
    }
  }
  throw lastErr;
}

export function toReolinkTime(date) {
  return {
    year: date.getFullYear(),
    mon: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    min: date.getMinutes(),
    sec: date.getSeconds(),
  };
}

/**
 * A source profile: knows how to turn a time range into local bytes.
 *
 * `camera` downloads by the filename the search returned. `nvr` must first
 * resolve the range to a generated fragment.
 */
export function makeSource({
  kind,
  client,
  channel,
  streamType = 'sub',
  maxChunkMinutes = 10,
  logger = console,
}) {
  if (kind === 'camera') {
    return {
      kind,
      hasTriggerNames: true,
      search: (day) => client.search({ channel, day, streamType }),
      coverage: (year, mon) => client.coverage({ channel, year, mon, streamType }),
      fetch: ({ clip, destPath }) => client.download({ source: clip.name, destPath }),
    };
  }
  if (kind === 'nvr') {
    return {
      kind,
      hasTriggerNames: false,
      search: (day) => client.search({ channel, day, streamType }),
      coverage: (year, mon) => client.coverage({ channel, year, mon, streamType }),
      fetch: ({ start, end, destPath }) =>
        fetchNvrRange({ client, channel, streamType, start, end, destPath, maxChunkMinutes, logger }),
    };
  }
  throw new Error(`Unknown source kind: ${kind}`);
}

/**
 * Parse trigger flags out of a camera recording filename.
 *
 * WARNING: this encoding is undocumented and model-specific. The bit meanings
 * below were inferred empirically by correlating each varying bit against
 * time-of-day and bitrate density across one day of driveway clips — they are
 * NOT vendor-confirmed, and the doorbell uses a different layout entirely.
 *
 * This is a FALLBACK only. Home Assistant history is the primary classifier.
 * If a firmware update changes the encoding, `labels` here will silently go
 * wrong, which is why every ledger record carries its `source`.
 */
export function parseTriggerBits(name, bitMap) {
  if (!name || !bitMap) return null;
  const parts = name.split('/').pop().replace('.mp4', '').split('_');
  const hex = parts[5];
  if (!hex) return null;
  let flags;
  try {
    flags = BigInt('0x' + hex);
  } catch {
    return null;
  }
  const labels = [];
  for (const [label, bit] of Object.entries(bitMap)) {
    if ((flags >> BigInt(bit)) & 1n) labels.push(label);
  }
  return { flags: hex, labels };
}

/**
 * Fetch an arbitrary time range from the NVR, in chunks.
 *
 * WHY CHUNKING IS MANDATORY: `NvrDownload` silently truncates long ranges. A
 * one-hour request against a busy channel deterministically returns a ~4-second
 * stub — the HTTP download completes cleanly and the byte count matches what
 * NvrDownload advertised, so nothing looks wrong. The first real backfill run
 * lost roughly half a day of audio this way and exited 0.
 *
 * Ten-minute requests return correct ~600s fragments. So the range is split,
 * each chunk verified against its expected duration, and the parts concatenated.
 *
 * Verification is the important half: without it a future firmware change to
 * the truncation threshold would silently start eating data again.
 */
export async function fetchNvrRange({
  client,
  channel,
  streamType,
  start,
  end,
  destPath,
  maxChunkMinutes = 10,
  tolerance = 0.9,
  maxSplitDepth = 4,
  minSplitSeconds = 60,
  probe = probeDuration,
  concat = concatParts,
  logger = console,
}) {
  const chunkMs = maxChunkMinutes * 60_000;
  const spans = [];
  for (let t = start.getTime(); t < end.getTime(); t += chunkMs) {
    spans.push([new Date(t), new Date(Math.min(t + chunkMs, end.getTime()))]);
  }

  const parts = [];
  let shortfall = 0;
  let partIndex = 0;

  /**
   * Fetch one span, halving it and retrying if the NVR truncates.
   *
   * The truncation threshold is undocumented and clearly not a fixed duration —
   * a 60-minute request returns ~4 seconds while 10-minute requests mostly
   * succeed, and even some 10-minute ones come back short. Rather than guess a
   * magic chunk size, back off adaptively until the NVR cooperates or the span
   * is too small to be worth splitting further.
   */
  const fetchSpan = async (s, e, depth = 0) => {
    const expectedSec = (e - s) / 1000;
    const partPath = `${destPath}.part${String(partIndex++).padStart(3, '0')}.mp4`;

    const fragment = await client.nvrResolveFragment({ channel, start: s, end: e, streamType });
    await client.download({ source: fragment.name, destPath: partPath });
    const actualSec = await probe(partPath);

    if (actualSec >= expectedSec * tolerance) {
      parts.push(partPath);
      return;
    }

    // Too short. Below a minute, splitting stops paying for itself — the
    // request overhead exceeds the data recovered — so keep what we got.
    if (depth >= maxSplitDepth || expectedSec <= minSplitSeconds) {
      shortfall += expectedSec - actualSec;
      logger.warn?.('camera.nvr.chunk_short', {
        channel,
        from: s.toISOString(),
        expectedSec: Math.round(expectedSec),
        actualSec: Math.round(actualSec),
        gaveUpAtDepth: depth,
      });
      parts.push(partPath);
      return;
    }

    await rm(partPath, { force: true });
    partIndex--;
    const mid = new Date(s.getTime() + (e - s) / 2);
    logger.debug?.('camera.nvr.chunk_split', {
      channel,
      from: s.toISOString(),
      expectedSec: Math.round(expectedSec),
      actualSec: Math.round(actualSec),
      depth,
    });
    await fetchSpan(s, mid, depth + 1);
    await fetchSpan(mid, e, depth + 1);
  };

  for (const [s, e] of spans) {
    await fetchSpan(s, e);
  }

  await concat(parts, destPath);
  await Promise.all(parts.map((p) => rm(p, { force: true })));

  const totalExpected = (end - start) / 1000;
  const totalActual = await probe(destPath);
  if (totalActual < totalExpected * tolerance) {
    // Loud, but not fatal: a partial hour is still worth archiving. The caller
    // records it, and the manifest carries the shortfall.
    logger.warn?.('camera.nvr.range_short', {
      channel,
      from: start.toISOString(),
      expectedSec: Math.round(totalExpected),
      actualSec: Math.round(totalActual),
      chunks: spans.length,
    });
  }
  return { bytes: 0, expectedSec: totalExpected, actualSec: totalActual, shortfallSec: shortfall };
}

/** Duration in seconds, or 0 if the file is unreadable/empty. */
export function probeDuration(file) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(0));
    proc.on('close', () => resolve(Number.parseFloat(out.trim()) || 0));
  });
}

/** Concatenate downloaded parts without re-encoding. */
async function concatParts(parts, destPath) {
  if (parts.length === 1) {
    await rename(parts[0], destPath);
    return destPath;
  }
  const listPath = `${destPath}.parts.txt`;
  await writeFile(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', destPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`concat failed (${code}): ${stderr.slice(-300)}`)),
    );
  });
  await rm(listPath, { force: true });
  return destPath;
}
