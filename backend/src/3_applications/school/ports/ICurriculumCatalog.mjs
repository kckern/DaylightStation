/**
 * @interface ICurriculumCatalog
 *
 * Read access to the PUBLISHED curriculum catalog (spec §3): units, documents,
 * and media manifests that have already been authored and reviewed elsewhere.
 * Authoring — purchased PDFs, AI extraction, drafts in flight — is out of scope;
 * the only thing this port promises is "here is what is sitting in the published
 * tree right now".
 *
 * TWO DELIBERATE CONTRACTS:
 *
 * 1. **Raw in, raw out.** Every method returns the parsed YAML unchanged.
 *    Validation and normalisation belong to the domain (`validateUnit`,
 *    `validateDocument`, `validateManifest`) so that a validator change never
 *    means an adapter change, and so `ValidateCatalog` sees exactly what the
 *    author wrote.
 *
 * 2. **A bad file isolates to itself.** The list methods return
 *    `{ items, errors }` rather than throwing: one unreadable file appears in
 *    `errors` and its siblings still load. A single malformed unit must never
 *    blank the catalog — the same posture the materials framework takes, where
 *    a missing block degrades to an empty catalog, never a 500.
 *
 * Error strings follow the domain convention, `<path>: <message>` — here the
 * path is `<kind>/<id>` (e.g. `units/math-3.4: ...`).
 *
 * @typedef {{ id: string, raw: * }} CatalogEntry
 * @typedef {{ items: CatalogEntry[], errors: string[] }} CatalogListing
 */
export class ICurriculumCatalog {
  /** @returns {Promise<CatalogListing>} */
  async listUnits() {
    throw new Error('ICurriculumCatalog.listUnits must be implemented');
  }

  /**
   * @param {string} unitId
   * @returns {Promise<*|null>} raw parsed YAML, or null when absent/unreadable
   */
  async getUnit(unitId) { // eslint-disable-line no-unused-vars
    throw new Error('ICurriculumCatalog.getUnit must be implemented');
  }

  /** @returns {Promise<CatalogListing>} */
  async listDocuments() {
    throw new Error('ICurriculumCatalog.listDocuments must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<*|null>} raw parsed YAML, or null when absent/unreadable
   */
  async getDocument(id) { // eslint-disable-line no-unused-vars
    throw new Error('ICurriculumCatalog.getDocument must be implemented');
  }

  /** @returns {Promise<CatalogListing>} */
  async listManifests() {
    throw new Error('ICurriculumCatalog.listManifests must be implemented');
  }

  /**
   * @param {string} id
   * @returns {Promise<*|null>} raw parsed YAML, or null when absent/unreadable
   */
  async getManifest(id) { // eslint-disable-line no-unused-vars
    throw new Error('ICurriculumCatalog.getManifest must be implemented');
  }

  /**
   * Every `work.yml` on the shelves — the per-curriculum config saying how a
   * work is structured, graded, sourced and printed (`validateWork`).
   *
   * Unlike the three above, a work id is a PATH: `<subject>/<work>`. Works are
   * the one catalog entity whose identity is positional, because a work IS its
   * folder; entries therefore also carry `subject` and `work` so a validator
   * can check the config against where it actually lives.
   *
   * @returns {Promise<CatalogListing>}
   */
  async listWorks() {
    throw new Error('ICurriculumCatalog.listWorks must be implemented');
  }

  /**
   * @param {string} id - `<subject>/<work>`
   * @returns {Promise<*|null>} raw parsed YAML, or null when absent/unreadable
   */
  async getWork(id) { // eslint-disable-line no-unused-vars
    throw new Error('ICurriculumCatalog.getWork must be implemented');
  }
}

export default ICurriculumCatalog;
