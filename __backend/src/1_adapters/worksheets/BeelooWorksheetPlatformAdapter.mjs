/**
 * BeelooWorksheetPlatformAdapter — IWorksheetPlatform over the household's
 * self-hosted Beeloo. Beeloo's names (`beeloo_id`, `contentType`,
 * `skillLevel`) stop here.
 *
 *   list:      GET <base>/api/pages?contentType=&skillLevel=&pageMax=250
 *              → { valid, items: [{ beeloo_id, theme, title, contentType, skillLevel }] }
 *   printable: GET <base>/media/<paper>/printable/<id>.pdf
 *   solution:  GET <base>/media/<paper>/solution/<id>.pdf
 *
 * Layer: ADAPTER (1_adapters/worksheets).
 * @module adapters/worksheets/BeelooWorksheetPlatformAdapter
 */
import { IWorksheetPlatform } from '#apps/common/ports/IWorksheetPlatform.mjs';

const ID_RE = /^[A-Za-z0-9_-]{4,32}$/;
const PAPERS = new Set(['letter', 'a4']);
const PAGE_MAX = 250; // Beeloo caps pageMax here
const DEFAULT_TIMEOUT_MS = 8000;

export class BeelooWorksheetPlatformAdapter extends IWorksheetPlatform {
  #baseUrl; #fetch; #logger; #timeoutMs;

  /**
   * @param {Object} deps
   * @param {string} deps.baseUrl - e.g. http://beeloo-app:8111
   * @param {Function} [deps.fetchImpl] - fetch-compatible function
   * @param {Object} deps.logger
   * @param {number} [deps.timeoutMs]
   */
  constructor({ baseUrl, fetchImpl = globalThis.fetch, logger, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    if (!baseUrl) throw new Error('BeelooWorksheetPlatformAdapter requires baseUrl');
    if (!logger) throw new Error('BeelooWorksheetPlatformAdapter requires logger');
    if (typeof fetchImpl !== 'function') throw new Error('BeelooWorksheetPlatformAdapter requires fetchImpl');
    this.#baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.#fetch = fetchImpl;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  get id() { return 'beeloo'; }

  async listActivities({ kind, level } = {}) {
    const url = `${this.#baseUrl}/api/pages?contentType=${encodeURIComponent(kind)}&skillLevel=${Number(level)}&pageMax=${PAGE_MAX}`;
    const res = await this.#get(url);
    if (!res.ok) throw new Error(`beeloo pages answered HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.valid || !Array.isArray(body.items)) throw new Error('beeloo pages answered valid:false');
    const rows = body.items.filter((p) => ID_RE.test(p?.beeloo_id ?? ''));
    if (rows.length !== body.items.length) {
      this.#logger.warn?.('worksheets.beeloo.malformed-items-dropped', {
        kind, level, dropped: body.items.length - rows.length,
      });
    }
    return rows.map((p) => ({
      externalId: p.beeloo_id,
      title: p.title ?? p.beeloo_id,
      kind: p.contentType,
      level: p.skillLevel,
      theme: p.theme ?? null,
    }));
  }

  async getPrintable(externalId, { paper = 'letter' } = {}) {
    const bytes = await this.#pdf(externalId, paper, 'printable');
    if (!bytes) throw new Error(`beeloo has no printable for ${externalId}`);
    return bytes;
  }

  async getSolution(externalId, { paper = 'letter' } = {}) {
    return this.#pdf(externalId, paper, 'solution');
  }

  async #pdf(externalId, paper, folder) {
    if (typeof externalId !== 'string' || !ID_RE.test(externalId)) {
      throw new Error(`not a beeloo page id: ${externalId}`);
    }
    if (!PAPERS.has(paper)) throw new Error(`unsupported paper: ${paper}`);
    const res = await this.#get(`${this.#baseUrl}/media/${paper}/${folder}/${externalId}.pdf`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`beeloo ${folder} answered HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.subarray(0, 4).toString() !== '%PDF') {
      throw new Error(`beeloo ${folder} for ${externalId} is not a PDF`);
    }
    return bytes;
  }

  async #get(url) {
    const started = Date.now();
    try {
      return await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (err) {
      this.#logger.warn?.('worksheets.beeloo.request-failed', {
        url, ms: Date.now() - started, error: err?.message ?? String(err),
      });
      throw err;
    }
  }
}

export default BeelooWorksheetPlatformAdapter;
