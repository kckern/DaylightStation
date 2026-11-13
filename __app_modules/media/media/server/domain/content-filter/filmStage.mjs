/**
 * Where a film is on the way from a rough VidAngel EDL to a parent-certified filter (Admin
 * library). A failed, interrupted or cancelled (stopped) run is a flag on the film, not a stage.
 */
export const STAGES = ['rough', 'running', 'refined', 'scenes', 'audited', 'machine', 'parent'];
export const STAGE_LABELS = {
  rough: 'Rough', running: 'Running', refined: 'Refined', scenes: 'Scenes built',
  audited: 'Audited', machine: 'Machine-certified', parent: 'Parent-certified',
};

/**
 * @param {{ hasRefined?: boolean, hasScenesKey?: boolean, audit?: { ok: boolean, fresh: boolean }|null,
 *   certificationLevel?: string, job?: { status: string }|null }} facts
 */
export function filmStage({ hasRefined = false, hasScenesKey = false, audit = null, certificationLevel = 'none', job = null } = {}) {
  if (job && (job.status === 'queued' || job.status === 'running')) return 'running';
  if (!hasRefined) return 'rough';
  if (!hasScenesKey) return 'refined';
  if (!audit) return 'scenes';
  const passed = audit.ok === true && audit.fresh === true;
  if (passed && certificationLevel === 'parent') return 'parent';
  if (passed && certificationLevel === 'machine') return 'machine';
  return 'audited';
}
