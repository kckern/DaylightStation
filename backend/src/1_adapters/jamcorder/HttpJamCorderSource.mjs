/**
 * HttpJamCorderSource — talks to the JamCorder device over HTTP.
 *   list:     POST http://<host>/api/files/list/detailed  {filepath}
 *   download: GET  http://<host>/sdcard/<listPath>
 * Layer: ADAPTER (1_adapters/jamcorder). Uses the injected HTTP client — the
 * composition root injects `axios` into harvesters (auto-JSON + auto-gzip;
 * throws on non-2xx / network error, surfaced to the use case).
 * @module adapters/jamcorder/HttpJamCorderSource
 */
import { IJamCorderSource } from '#apps/jamcorder/ports/IJamCorderSource.mjs';

const ROOT = '/JAMC';
const MAX_DEPTH = 5; // JAMC → year → session → file is 3; cap generously

export class HttpJamCorderSource extends IJamCorderSource {
  #httpClient; #host; #logger;

  constructor({ httpClient, host, logger = console }) {
    super();
    if (!httpClient) throw new Error('HttpJamCorderSource requires httpClient');
    if (!host) throw new Error('HttpJamCorderSource requires host');
    this.#httpClient = httpClient;
    this.#host = host;
    this.#logger = logger;
  }

  async listRecordings() {
    const out = [];
    await this.#walk(ROOT, 0, out);
    return out;
  }

  async download(ref) {
    const resp = await this.#httpClient.get(`http://${this.#host}${ref.downloadPath}`, { responseType: 'arraybuffer' });
    return Buffer.from(resp.data);
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
