/**
 * IConciergeMemory — household-scoped working memory.
 *   get(key: string): Promise<any>
 *   set(key: string, value: any): Promise<void>
 *   merge(key: string, partial: object): Promise<void>
 */
export function isConciergeMemory(obj) {
  return !!obj
    && typeof obj.get === 'function'
    && typeof obj.set === 'function'
    && typeof obj.merge === 'function';
}

export function assertConciergeMemory(obj) {
  if (!isConciergeMemory(obj)) throw new Error('Object does not implement IConciergeMemory');
}

export default { isConciergeMemory, assertConciergeMemory };
