/**
 * Domain-neutral source of synthesized question banks.
 *
 * Implementations provide:
 *   resolve(bankId): rawBank | null
 *   listSummaries(): Array<{summaryId, bankId, title, itemType, available,
 *                            collections, topics, subject}>
 *
 * Subject values and namespaces are opaque data; callers never branch on them
 * to select a generator.
 */
export class IBankSource {
  resolve(_bankId) { throw new Error('IBankSource.resolve not implemented'); }
  listSummaries() { throw new Error('IBankSource.listSummaries not implemented'); }
}
