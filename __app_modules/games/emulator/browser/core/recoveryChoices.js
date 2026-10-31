/**
 * The server copies a recovery dialog offers. A battery game lists in-game
 * saves, not autosave ticks: copies that share one in-game save collapse into
 * one entry, restoring the newest copy of it, dated when it first appeared
 * (the moment the kid saved). State games keep one entry per copy.
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
    if (group) group.revision = point.revision;
    else groups.set(id, { revision: point.revision, label: point.kind === 'reset' ? 'New game started' : 'In-game save', at: point.createdAt ?? null });
  }
  return [...groups.values()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
