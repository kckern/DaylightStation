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
