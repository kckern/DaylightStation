import { DaylightAPI } from '@/lib/api.mjs';

const commandId = () => `web:${crypto.randomUUID?.() || `${Date.now()}:${Math.random()}`}`;

export async function fetchBoot() {
  const [config, catalog] = await Promise.all([
    DaylightAPI('api/v1/gaming/environments/group-play/profile'),
    DaylightAPI('api/v1/gaming/environments/group-play/catalog'),
  ]);
  const sets = (catalog.entries || []).map((entry) => ({
    ...entry,
    game: entry.experience_id,
    setId: entry.content_id,
    definitionId: entry.definition_id,
    setupProfile: entry.setup_profile || { kind: entry.setup || 'none' },
    roundCount: entry.round_count,
  }));
  return { config, sets };
}

export function createSession({ definitionId, teams = [], hostMode = 'human', setupProfile = {} }) {
  const participants = teams.flatMap((team) => team.members || []);
  const setup = {
    ...(teams.length > 0 ? { teams } : {}),
    ...(setupProfile.host_modes ? { host: { mode: hostMode } } : {}),
    ...(setupProfile.verifier === 'opponent'
      ? { verifier_id: teams[1]?.members?.[0]?.id || teams[1]?.members?.[0]?.user_id || null }
      : {}),
  };
  return DaylightAPI('api/v1/gaming/sessions', {
    definition_id: definitionId,
    seats: teams, setup, participants,
  }, 'POST');
}

export function fetchSession(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}`); }
export function fetchSet(game, setId) { return DaylightAPI(`api/v1/gaming/experiences/${game}/content/${setId}`); }

export async function sendRuleCommand(sessionId, command, { actorId = 'host' } = {}) {
  const current = await fetchSession(sessionId);
  return DaylightAPI(`api/v1/gaming/sessions/${sessionId}/commands`, {
    command_id: commandId(), actor_id: actorId, expected_revision: current.header.revision,
    logical_time: performance.timeOrigin + performance.now(), correlation_id: `session:${sessionId}`,
    command,
  }, 'POST');
}

export function finishSession(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/close`, { reason: 'experience_complete' }, 'POST'); }
export function printHostPacket(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/host-packet/print`, {}, 'POST'); }
export function fetchDrawingCheckpoint(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`); }
export function saveDrawingCheckpoint(id, strokes) { return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`, { strokes }, 'PUT'); }
export function deleteDrawingCheckpoint(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/drawing-checkpoint`, {}, 'DELETE'); }
