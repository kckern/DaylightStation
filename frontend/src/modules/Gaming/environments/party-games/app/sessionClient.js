import { DaylightAPI } from '@/lib/api.mjs';

export async function fetchBoot({ diagnosticSessionId = null, sessionId = null } = {}) {
  if (diagnosticSessionId && !diagnosticSessionId.startsWith('diagnostic:')) throw new Error('Diagnostic session id must use the diagnostic: prefix');
  if (diagnosticSessionId && sessionId) throw new Error('Only one session attachment may be requested');
  const attachedSessionId = diagnosticSessionId || sessionId;
  const [config, catalog, attachedSession] = await Promise.all([
    DaylightAPI('api/v1/gaming/environments/party-games/profile'),
    DaylightAPI('api/v1/gaming/environments/party-games/catalog'),
    attachedSessionId ? DaylightAPI(`api/v1/gaming/sessions/${encodeURIComponent(attachedSessionId)}`) : null,
  ]);
  const sets = (catalog.entries || []).map((entry) => ({
    ...entry,
    game: entry.experience_id,
    setId: entry.content_id,
    definitionId: entry.definition_id,
    setupProfile: entry.setup_profile || { kind: entry.setup || 'none' },
    roundCount: entry.round_count,
  }));
  return { config, sets, attachedSession, diagnosticSession: diagnosticSessionId ? attachedSession : null };
}

export function createSession({ definitionId, seats = [], teams = null, hostMode = 'human', setupProfile = {} }) {
  const resolvedSeats = teams || seats;
  const participants = resolvedSeats.flatMap((seat) => seat.members || []);
  const setup = {
    ...(resolvedSeats.length > 0 ? { seats: resolvedSeats } : {}),
    ...(['teams', 'individuals-or-teams'].includes(setupProfile.kind) && resolvedSeats.length > 0 ? { teams: resolvedSeats } : {}),
    ...(setupProfile.host_modes ? { host: { mode: hostMode } } : {}),
    ...(setupProfile.verifier === 'opponent'
      ? { verifier_id: resolvedSeats[1]?.members?.[0]?.id || resolvedSeats[1]?.members?.[0]?.user_id || null }
      : {}),
  };
  return DaylightAPI('api/v1/gaming/sessions', {
    definition_id: definitionId,
    surface_id: 'party-games',
    seats: resolvedSeats, setup, participants,
  }, 'POST');
}

export function printHostPacket(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/host-packet/print`, {}, 'POST'); }
