import { DaylightAPI } from '@/lib/api.mjs';

export async function fetchBoot() {
  const [config, catalog] = await Promise.all([
    DaylightAPI('api/v1/gaming/environments/party-games/profile'),
    DaylightAPI('api/v1/gaming/environments/party-games/catalog'),
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
    surface_id: 'party-games',
    seats: teams, setup, participants,
  }, 'POST');
}

export function printHostPacket(id) { return DaylightAPI(`api/v1/gaming/sessions/${id}/host-packet/print`, {}, 'POST'); }
