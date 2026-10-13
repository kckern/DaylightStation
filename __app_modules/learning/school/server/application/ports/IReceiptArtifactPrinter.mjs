export class IReceiptArtifactPrinter {
  /**
   * @returns {Promise<{printed: boolean, confirmed: boolean, faulted: boolean,
   *   reason?: string|null}>} a dispatched-but-unverified job is printed but
   *   not confirmed; only positive fault/refusal evidence is a failed print
   */
  async print(_artifact) { throw new Error('IReceiptArtifactPrinter.print() not implemented'); }
}
