/**
 * ValidateCatalog — the promotion gate for the curriculum catalog (spec §3, §11).
 *
 * Runtime must only ever serve a published, reviewed catalog. Authoring happens
 * elsewhere; what matters here is one question, asked before anything is
 * promoted: does everything in the published tree parse, validate, and resolve?
 * CI and the ingestion pipeline call this and refuse to promote on a false `ok`.
 *
 * ORDERING IS THE WHOLE TRICK. The reference sets handed to `validateUnit` are
 * built from entities that ACTUALLY VALIDATED — never from what merely happened
 * to be on disk. So a unit pointing at a document that failed its own validation
 * is reported as a dangling reference, not quietly accepted because a file with
 * that name exists. A broken document must not be reachable from a unit.
 *
 * Bank ids are injected rather than read: the bank catalog is a different
 * datastore with a different id shape, and this use case has no business
 * knowing which. `measureProbe` is injected for the same reason plus one more —
 * the renderer is a heavy dependency the application layer may not import, and
 * keeping it a callback lets the gate be tested without it.
 *
 * Nothing here writes and nothing mutates: every input is read through the port
 * and every output is fresh.
 */
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { validateManifest } from '#domains/school/curriculum/manifestValidation.mjs';
import { validateUnit, isPublishable } from '#domains/school/curriculum/unitValidation.mjs';

const LETTER = 'letter';

export class ValidateCatalog {
  #catalog;
  #bankIds;
  #measureProbe;

  /**
   * @param {object} deps
   * @param {import('../ports/ICurriculumCatalog.mjs').ICurriculumCatalog} deps.catalog
   * @param {Iterable<string>} [deps.bankIds] - ids of every question bank that exists
   * @param {(document: object, ctx: {id: string}) => (void|{errors?: string[]}|Promise<*>)} [deps.measureProbe]
   *   optional render-measure callback; only consulted under `renderProbe`
   */
  constructor({ catalog, bankIds = [], measureProbe = null } = {}) {
    if (!catalog) throw new Error('ValidateCatalog requires a catalog');
    this.#catalog = catalog;
    this.#bankIds = bankIds instanceof Set ? bankIds : new Set(bankIds);
    this.#measureProbe = typeof measureProbe === 'function' ? measureProbe : null;
  }

  /**
   * @param {{ renderProbe?: boolean }} [options] - when true, additionally push
   *   every valid `target: letter` document through the injected probe. Off by
   *   default because it is the expensive half.
   * @returns {Promise<{
   *   ok: boolean,
   *   unitErrors: Record<string, string[]>,
   *   documentErrors: Record<string, string[]>,
   *   manifestErrors: Record<string, string[]>,
   *   catalogErrors: string[],
   *   summary: { units: number, documents: number, manifests: number, publishable: number },
   * }>}
   */
  async execute({ renderProbe = false } = {}) {
    const [units, documents, manifests] = await Promise.all([
      this.#catalog.listUnits(),
      this.#catalog.listDocuments(),
      this.#catalog.listManifests(),
    ]);

    // Files the datastore could not even parse. They are a promotion blocker in
    // their own right, and reporting them here is what keeps a malformed file
    // from looking like an absent one.
    const catalogErrors = [
      ...(units.errors ?? []),
      ...(documents.errors ?? []),
      ...(manifests.errors ?? []),
    ];

    // Documents and manifests first: units resolve against what survives here.
    const documentErrors = {};
    const validDocuments = new Map();
    for (const { id, raw } of documents.items ?? []) {
      const { errors, document } = validateDocument(raw);
      if (errors.length) documentErrors[id] = errors;
      else validDocuments.set(id, document);
    }

    const manifestErrors = {};
    const validManifests = new Map();
    for (const { id, raw } of manifests.items ?? []) {
      const { errors, manifest } = validateManifest(raw);
      if (errors.length) manifestErrors[id] = errors;
      else validManifests.set(id, manifest);
    }

    const sets = {
      bankIds: this.#bankIds,
      documentIds: new Set(validDocuments.keys()),
      manifestIds: new Set(validManifests.keys()),
    };

    const unitErrors = {};
    let publishable = 0;
    for (const { id, raw } of units.items ?? []) {
      const { errors, unit } = validateUnit(raw, sets);
      // Keyed by the CATALOG id (the filename the author must go fix), which is
      // the only name a unit too broken to declare a `unitId` still has.
      if (errors.length) unitErrors[id] = errors;
      else if (isPublishable(unit)) publishable += 1;
    }

    if (renderProbe && this.#measureProbe) {
      await this.#runRenderProbe(validDocuments, documentErrors);
    }

    const ok = catalogErrors.length === 0
      && Object.keys(unitErrors).length === 0
      && Object.keys(documentErrors).length === 0
      && Object.keys(manifestErrors).length === 0;

    return {
      ok,
      unitErrors,
      documentErrors,
      manifestErrors,
      catalogErrors,
      summary: {
        units: (units.items ?? []).length,
        documents: (documents.items ?? []).length,
        manifests: (manifests.items ?? []).length,
        publishable,
      },
    };
  }

  /**
   * Measure-pass every valid letter-target document. A probe that throws fails
   * only its own document — one document that cannot be laid out must not stop
   * the rest of the catalog from being reported on.
   */
  async #runRenderProbe(validDocuments, documentErrors) {
    for (const [id, document] of validDocuments) {
      if (!document.target.includes(LETTER)) continue;
      let errors = [];
      try {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await this.#measureProbe(document, { id });
        if (Array.isArray(outcome?.errors)) errors = outcome.errors;
      } catch (err) {
        errors = [`render probe failed: ${err?.message ?? String(err)}`];
      }
      if (errors.length) documentErrors[id] = [...(documentErrors[id] ?? []), ...errors];
    }
  }
}

export default ValidateCatalog;
