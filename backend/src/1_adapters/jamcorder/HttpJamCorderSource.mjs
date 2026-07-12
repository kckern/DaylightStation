/**
 * HttpJamCorderSource — talks to the JamCorder device over HTTP.
 *   list:     POST http://<host>/api/files/list/detailed  {filepath}
 *   download: GET  http://<host>/sdcard/<listPath>
 * Layer: ADAPTER (1_adapters/jamcorder). Injected HttpClient.
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
    return this.#httpClient.downloadBuffer(`http://${this.#host}${ref.downloadPath}`);
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
    const resp = await this.#httpClient.requestRaw(
      'POST',
      `http://${this.#host}/api/files/list/detailed`,
      { body: { filepath }, responseType: 'json' },
    );
    if (!resp || !resp.ok) {
      throw new Error(`JamCorder list failed for ${filepath}: HTTP ${resp?.status}`);
    }
    return Array.isArray(resp.data?.files) ? resp.data.files : [];
  }
}

export default HttpJamCorderSource;
