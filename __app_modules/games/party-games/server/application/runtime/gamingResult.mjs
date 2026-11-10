import { gamingResult } from "../../../../../../__capabilities/gaming/portable/experience/index.mjs";

export function completedResult(view, { abandoned = false } = {}) {
  if (view?.header?.status !== 'complete' || !view.header.experience?.id) return null;
  const casual = view.state?.competition === false;
  const winner = casual ? null : view.state?.winner_id || view.state?.winnerId || view.state?.winner || null;
  const scores = Object.entries(casual ? {} : view.state?.scores || {}).filter(([, value]) => Number.isFinite(value))
    .map(([subject_id, value]) => ({ subject_id, value }));
  return gamingResult({
    sessionId: view.header.session_id,
    experienceId: view.header.experience.id,
    status: abandoned ? 'abandoned' : 'completed',
    outcome: abandoned ? { kind: 'abandoned' } : winner ? { kind: 'win', winner_ids: [String(winner)] } : { kind: 'completed' },
    scores,
    durationMs: 0,
    evidence: { revision: view.header.revision },
  });
}
