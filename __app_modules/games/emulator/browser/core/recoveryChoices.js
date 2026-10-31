/**
 * The server copies a recovery dialog offers. A battery game collapses copies
 * that carry identical battery bytes into one entry, restoring (and dated by)
 * the newest of them. Games that use SRAM as scratch change those bytes during
 * play, so an entry is a distinct battery copy, not necessarily a distinct
 * in-game save. State games keep one entry per copy.
 *
 * @returns {Array<{ revision: string, label: string, at: string|null }>}
 */
export function recoveryChoices(saveMode, checkpoints = []) {
  const usable = checkpoints.filter(point => point.usable);
  if (saveMode !== 'battery') {
    return usable.map(point => ({ revision: point.revision,
      label: point.kind === 'reset' ? 'Fresh start recorded' : 'Restore saved copy', at: point.createdAt ?? null }));
  }
  const byOrder = [...usable].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  const groups = new Map();
  for (const point of byOrder) {
    const battery = point.artifacts?.battery?.hash;
    const id = point.kind === 'reset' ? `reset:${point.revision}` : battery ? `save:${battery}` : `copy:${point.revision}`;
    const group = groups.get(id);
    const label = point.kind === 'reset' ? 'New game started' : battery ? 'In-game save' : 'Restore saved copy';
    if (group) Object.assign(group, { revision: point.revision, at: point.createdAt ?? null });
    else groups.set(id, { revision: point.revision, label, at: point.createdAt ?? null });
  }
  return [...groups.values()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
