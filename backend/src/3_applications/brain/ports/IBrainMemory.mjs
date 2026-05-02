/**
 * IBrainMemory — household-scoped working memory.
 *   get(key: string): Promise<any>
 *   set(key: string, value: any): Promise<void>
 *   merge(key: string, partial: object): Promise<void>
 */
export function isBrainMemory(obj) {
  return !!obj
    && typeof obj.get === 'function'
    && typeof obj.set === 'function'
    && typeof obj.merge === 'function';
}

export function assertBrainMemory(obj) {
  if (!isBrainMemory(obj)) throw new Error('Object does not implement IBrainMemory');
}

export default { isBrainMemory, assertBrainMemory };
