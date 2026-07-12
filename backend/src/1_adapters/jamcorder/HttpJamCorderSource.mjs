/**
 * HttpJamCorderSource — talks to the JamCorder device over HTTP.
 *   list:     POST http://<host>/api/files/list/detailed  {filepath}  (injected axios)
 *   download: GET  http://<host>/sdcard/<listPath>                    (node:http, insecure parser)
 *
 * The LIST goes through the injected HTTP client (the composition root injects
 * `axios` into harvesters — auto-JSON + auto-gzip; throws on non-2xx/network,
 * surfaced to the use case). The DOWNLOAD cannot: the device serves `.mid` files
 * with BOTH `Content-Length` and `Transfer-Encoding` headers (non-compliant), so
 * Node's strict HTTP parser (and axios/undici) rejects the response. We fetch the
 * bytes with node:http + `insecureHTTPParser: true` — a device-compat concern the
 * adapter legitimately owns. Injectable (`binaryGet`) so it stays unit-testable.
 *
 * Layer: ADAPTER (1_adapters/jamcorder).
 * @module adapters/jamcorder/HttpJamCorderSource
 */
import http from 'node:http';
import { IJamCorderSource } from '#apps/jamcorder/ports/IJamCorderSource.mjs';

const ROOT = '/JAMC';
const MAX_DEPTH = 5; // JAMC → year → session → file is 3; cap generously
const DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * GET binary bytes tolerating the device's non-compliant response headers.
 * @param {string} url @param {{timeoutMs?:number}} [opts] @returns {Promise<Buffer>}
 */
export function httpGetBufferInsecure(url, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { insecureHTTPParser: true }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`JamCorder download failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('JamCorder download timeout')));
  });
}

export class HttpJamCorderSource extends IJamCorderSource {
  #httpClient; #host; #logger; #binaryGet;

  constructor({ httpClient, host, logger = console, binaryGet = httpGetBufferInsecure }) {
    super();
    if (!httpClient) throw new Error('HttpJamCorderSource requires httpClient');
    if (!host) throw new Error('HttpJamCorderSource requires host');
    this.#httpClient = httpClient;
    this.#host = host;
    this.#logger = logger;
    this.#binaryGet = binaryGet;
  }

  async listRecordings() {
    const out = [];
    await this.#walk(ROOT, 0, out);
    return out;
  }

  async download(ref) {
    return this.#binaryGet(`http://${this.#host}${ref.downloadPath}`);
  }

  async #walk(dirPath, depth, out) {
    if (depth > MAX_DEPTH) return;
    const files = await this.#listDir(dirPath);
    for (const entry of files) {
      const name = String(entry.filename || '').replace(/\/+$/, '');
      if (!name) continue;
      const childListPath = `${dirPath}/${name}`;
      if (entry.isDirectory) {
        await this.#walk(childListPath, depth + 1, out);
      } else if (name.toLowerCase().endsWith('.mid')) {
        out.push({ listPath: childListPath, downloadPath: `/sdcard${childListPath}` });
      }
    }
  }

  async #listDir(filepath) {
    // axios: throws on non-2xx / network error (surfaced to the use case as an
    // error harvest); auto-parses JSON and auto-decompresses the gzipped body.
    const resp = await this.#httpClient.post(
      `http://${this.#host}/api/files/list/detailed`,
      { filepath },
      { responseType: 'json' },
    );
    const files = resp?.data?.files;
    if (!Array.isArray(files)) {
      this.#logger.warn?.('jamcorder.list.unexpected', { filepath, status: resp?.status });
      return [];
    }
    return files;
  }
}

export default HttpJamCorderSource;
