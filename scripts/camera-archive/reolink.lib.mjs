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

  /** Stream a named recording to disk. Returns bytes written. */
  async download({ source, destPath, timeoutMs = 300000 }) {
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
export function makeSource({ kind, client, channel, streamType = 'sub' }) {
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
      fetch: async ({ start, end, destPath }) => {
        const fragment = await client.nvrResolveFragment({ channel, start, end, streamType });
        return client.download({ source: fragment.name, destPath });
      },
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
