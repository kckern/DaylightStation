/**
 * IFormMapStore — persistence contract for printed OMR form maps.
 * @module applications/school/ports/IFormMapStore
 *
 * The PDF renderer emits a form map beside every sheet that carries bubbles:
 * `{ formVersion, documentId, seed, variant, marks: [{itemId, choice, xPt, yPt, rPt, page}] }`
 * — the exact coordinates of every mark it printed. That artifact is the ONLY
 * thing that can turn a reader's column masks back into answers, and the scan
 * happens minutes or days after the print. Without somewhere to keep it, the
 * paper-grading loop has a hole in the middle.
 *
 * The form id is the issued ARTIFACT id, which is what makes the two idempotency
 * rules line up: a reprint reuses the artifact id and therefore resolves to the
 * identical form map, while a remediation variant is a different artifact and
 * gets its own.
 */
export class IFormMapStore {
  /**
   * @param {string} formId - the issued artifact id
   * @param {object} formMap - the renderer's artifact, stored verbatim
   * @returns {Promise<object>} the stored form map
   */
  async put(formId, formMap) {
    throw new Error('IFormMapStore.put must be implemented');
  }

  /**
   * @param {string} formId
   * @returns {Promise<object|null>} null when absent or unreadable — a scan
   *   against an unknown form must produce an explanation, not an exception
   */
  async get(formId) {
    throw new Error('IFormMapStore.get must be implemented');
  }
}

export default IFormMapStore;
