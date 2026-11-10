import { DaylightAPI } from '@/lib/api.mjs';

const commandId = () => `web:${crypto.randomUUID?.() || `${Date.now()}:${Math.random()}`}`;

export function fetchSession(id) {
  return DaylightAPI(`api/v1/gaming/sessions/${id}`);
}

export function fetchExperienceContent(experienceId, contentId) {
  return DaylightAPI(`api/v1/gaming/experiences/${experienceId}/content/${contentId}`);
}

export function ruleCommandEnvelope(sessionId, command, { actorId = 'host', expectedRevision, commandId: id = commandId(), logicalTime = performance.timeOrigin + performance.now() } = {}) {
  return { command_id: id, actor_id: actorId, expected_revision: expectedRevision,
    logical_time: logicalTime, correlation_id: `session:${sessionId}`, command };
}
export function postRuleEnvelope(sessionId, envelope, { signal } = {}) {
  const path = `api/v1/gaming/sessions/${sessionId}/commands`;
  return signal ? DaylightAPI(path, envelope, 'POST', { signal }) : DaylightAPI(path, envelope, 'POST');
}
export async function sendRuleCommand(sessionId, command, { actorId = 'host' } = {}) {
  const current = await fetchSession(sessionId);
  return postRuleEnvelope(sessionId, ruleCommandEnvelope(sessionId, command, {actorId, expectedRevision: current.header.revision}));
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
