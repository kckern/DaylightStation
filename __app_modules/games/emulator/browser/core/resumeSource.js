const issue = (message, code) => Object.assign(new Error(message), { code });

/**
 * What a checkpoint record resumes from. A battery game resumes from its
 * in-game save: a snapshot carries its own older copy of that save, so loading
 * one over an existing in-game save would put the older save back. The
 * snapshot is used only when no in-game save exists yet.
 *
 * @returns {{ kind: 'fresh'|'state'|'battery', artifact: 'snapshot'|'battery'|null }}
 */
export function resumeSource(saveMode, record) {
  if (!record || record.kind === 'reset') return { kind: 'fresh', artifact: null };
  if (saveMode === 'battery' && record.battery) return { kind: 'battery', artifact: 'battery' };
  if (record.snapshot) return { kind: 'state', artifact: 'snapshot' };
  throw issue('The saved checkpoint has no usable resume data', 'ECHECKPOINTCORRUPT');
}

/**
 * The resume points a launch may offer, default first. "Where they stopped"
 * (the snapshot) is offered beside the in-game save only for a capture the
 * console made itself, where both came from one moment; a migrated or
 * imported pair may hold a snapshot older than the in-game save.
 *
 * @returns {Array<{ id: 'continue'|'where-stopped', kind: 'battery'|'state', artifact: 'battery'|'snapshot', at: string|null }>}
 */
export function resumeChoices(saveMode, record) {
  if (!record || record.kind === 'reset') return [];
  const at = record.createdAt ?? null;
  const continueSave = { id: 'continue', kind: 'battery', artifact: 'battery', at };
  const whereStopped = { id: 'where-stopped', kind: 'state', artifact: 'snapshot', at };
  if (saveMode === 'battery' && record.battery) return record.snapshot && record.kind === 'save' ? [continueSave, whereStopped] : [continueSave];
  return record.snapshot ? [whereStopped] : [];
}
