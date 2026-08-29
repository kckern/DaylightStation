import { DaylightAPI } from '@/lib/api.mjs';

const commandId = () => `web:${crypto.randomUUID?.() || `${Date.now()}:${Math.random()}`}`;

export function fetchSession(id) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}`);
}

export function fetchExperienceContent(experienceId, contentId) {
  return DaylightAPI(`api/v1/gaming/experiences/${experienceId}/content/${contentId}`);
}

export async function sendRuleCommand(sessionId, command, { actorId = 'host' } = {}) {
  const current = await fetchSession(sessionId);
  return DaylightAPI(`api/v1/gaming/sessions/${sessionId}/commands`, {
    command_id: commandId(),
    actor_id: actorId,
    expected_revision: current.header.revision,
    logical_time: performance.timeOrigin + performance.now(),
    correlation_id: `session:${sessionId}`,
    command,
  }, 'POST');
}

export function finishSession(id) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}/close`, { reason: 'experience_complete' }, 'POST');
}

export function fetchDrawingCheckpoint(id) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`);
}

export function saveDrawingCheckpoint(id, strokes) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`, { strokes }, 'PUT');
}

export function deleteDrawingCheckpoint(id) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`, {}, 'DELETE');
}
