/**
 * ILifelogRead
 *   recentEntries({ days?: number, kinds?: string[], username?: string }):
 *     Promise<Array<{ date, kind, summary, source }>>
 *   queryJournal({ text: string, limit?: number, username?: string }):
 *     Promise<Array<{ date, excerpt, score }>>
 */
export function isLifelogRead(obj) {
  return !!obj
    && typeof obj.recentEntries === 'function'
    && typeof obj.queryJournal === 'function';
}

export function assertLifelogRead(obj) {
  if (!isLifelogRead(obj)) throw new Error('Object does not implement ILifelogRead');
}

export default { isLifelogRead, assertLifelogRead };
