/**
 * IWorksheetPlatform — a source of printable activity pages (mazes, sudoku,
 * tracing…). The vocabulary is the household's, not the platform's: an
 * adapter maps its own ids and type names onto these.
 *
 * Implementations: BeelooWorksheetPlatformAdapter
 *
 * @typedef {Object} WorksheetActivity
 * @property {string} externalId - the platform's page id
 * @property {string} title
 * @property {string} kind - maze | sudoku | tracing | dots | coloring | wordsearch | …
 * @property {number} level - the platform's difficulty step (higher = harder)
 * @property {string|null} theme
 */
export class IWorksheetPlatform {
  /** @returns {string} stable platform id, matching `url_rules[].platform` in the barcode config */
  get id() { throw new Error('IWorksheetPlatform.id must be implemented'); }

  /**
   * @param {{kind: string, level: number, paper?: 'letter'|'a4'}} query
   * @returns {Promise<WorksheetActivity[]>}
   */
  async listActivities(query) { throw new Error('IWorksheetPlatform.listActivities must be implemented'); }

  /**
   * @param {string} externalId
   * @param {{paper?: 'letter'|'a4'}} [opts]
   * @returns {Promise<Buffer>} the printable PDF
   */
  async getPrintable(externalId, { paper = 'letter' } = {}) { throw new Error('IWorksheetPlatform.getPrintable must be implemented'); }

  /**
   * @param {string} externalId
   * @param {{paper?: 'letter'|'a4'}} [opts]
   * @returns {Promise<Buffer|null>} the answer key, or null when the platform has none
   */
  async getSolution(externalId, { paper = 'letter' } = {}) { throw new Error('IWorksheetPlatform.getSolution must be implemented'); }
}

/**
 * Duck-type check for an IWorksheetPlatform implementation.
 * @param {any} obj
 * @returns {boolean}
 */
export function isWorksheetPlatform(obj) {
  return Boolean(obj) && typeof obj.listActivities === 'function'
    && typeof obj.getPrintable === 'function' && typeof obj.getSolution === 'function';
}

export default IWorksheetPlatform;
