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
 * Tracing rotation uses the complete `/api/printables` catalogue plus batched
 * computed metadata, cached per configuration. Other kinds use a sample.
 *
 * THE DEFAULT LIST IS A SAMPLE. `/api/pages` answers a RANDOM sample of the matching
 * pages, capped at 250: two consecutive calls differ, and a `pageMax` above
 * 250 is still capped. So `listActivities` is a sample of the level, not the
 * whole pool, and the launcher's `pool-exhausted` can fire before the level is
 * really used up once household history nears 250 pages of one kind and
 * level. The launcher asks once more for a fresh sample before giving up.
 *
 * Layer: ADAPTER (1_adapters/worksheets).
 * @module adapters/worksheets/BeelooWorksheetPlatformAdapter
 */
import { IWorksheetPlatform } from '#apps/common/ports/IWorksheetPlatform.mjs';

const ID_RE = /^[A-Za-z0-9_-]{4,32}$/;
const PAPERS = new Set(['letter', 'a4']);
const PAGE_MAX = 250; // Beeloo caps pageMax here; the answer is a random sample (see header)
const DEFAULT_TIMEOUT_MS = 8000;

export class BeelooWorksheetPlatformAdapter extends IWorksheetPlatform {
  #baseUrl; #fetch; #logger; #timeoutMs;
  #tracingCatalogues = new Map();

  /**
   * @param {Object} deps
   * @param {string} deps.baseUrl - e.g. http://<container>:<port> (the `beeloo` key in services.yml)
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

  async listActivities({ kind, level, rotation } = {}) {
    if (kind === 'tracing' && rotation) {
      const key = JSON.stringify({ level, rotation });
      if (!this.#tracingCatalogues.has(key)) {
        const pending = this.#tracingCatalogue(level, rotation).catch(err => {
          this.#tracingCatalogues.delete(key);
          throw err;
        });
        this.#tracingCatalogues.set(key, pending);
      }
      return (await this.#tracingCatalogues.get(key)).map(row => ({ ...row }));
    }
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

  /** Full semantic metadata also resolves worksheets issued before rotation existed. */
  async getActivity(externalId) {
    if (!ID_RE.test(externalId)) throw new Error('not a beeloo page id');
    const rows = await this.#metadata([externalId]);
    return rows[0] ?? null;
  }

  async #metadata(ids) {
    const query = new URLSearchParams({ includeData: 'true' });
    for (const id of ids) query.append('beeloo_ids[]', id);
    const res = await this.#get(`${this.#baseUrl}/api/pages?${query}`);
    if (!res.ok) throw new Error(`beeloo metadata answered HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.valid || !Array.isArray(body.items)) throw new Error('beeloo metadata unavailable');
    return body.items.filter(p => ID_RE.test(p?.beeloo_id ?? '')).map(p => {
      const computed = p.data?.computedData;
      const character = String(computed?.content ?? '').trim().toUpperCase();
      const single = ['uppercaseSingleLetter', 'upperlowercaseSingleLetter'].includes(computed?.templateId);
      return { externalId: p.beeloo_id, title: p.title ?? p.beeloo_id, kind: p.contentType,
        level: Number(p.skillLevel), theme: p.theme ?? null,
        ...(single && /^[A-Z0-9]$/.test(character) ? { character } : {}) };
    });
  }

  async #tracingCatalogue(level, rotation) {
    const levels = [...new Set([level, rotation.digitLevel])];
    const res = await this.#get(`${this.#baseUrl}/api/printables?contentType=tracing&skillLevel=${levels.join(',')}`);
    if (!res.ok) throw new Error(`beeloo catalogue answered HTTP ${res.status}`);
    const body = await res.json();
    if (!body?.valid || !Array.isArray(body.items)) throw new Error('beeloo catalogue unavailable');
    const ids = [...new Set([...body.items.map(p => p?.beeloo_id), ...(rotation.supplementalIds ?? [])])]
      .filter(id => ID_RE.test(id ?? ''));
    const rows = [];
    // Four bounded batches at a time; the catalogue is shared by concurrent callers.
    for (let offset = 0; offset < ids.length; offset += 400) {
      const batches = [];
      for (let at = offset; at < Math.min(offset + 400, ids.length); at += 100) {
        batches.push(this.#metadata(ids.slice(at, at + 100)));
      }
      rows.push(...(await Promise.all(batches)).flat());
    }
    const pages = rows.filter(p => p.kind === 'tracing' && p.character
      && rotation.characters.includes(p.character)
      && p.level === (/^[0-9]$/.test(p.character) ? rotation.digitLevel : level));
    const found = new Set(pages.map(p => p.character));
    if ([...rotation.characters].some(c => !found.has(c))) throw new Error('beeloo tracing catalogue is missing configured characters');
    return pages;
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
