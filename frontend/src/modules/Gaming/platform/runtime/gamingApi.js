async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || `Gaming request failed (${response.status})`), { status: response.status, code: body.error, details: body.details });
  return body;
}

const projectSession = (view, gameId = null) => ({
  session_id: view.header.session_id,
  game_id: view.definition?.game_id || gameId,
  status: view.header.status,
  revision: view.header.revision,
  definition_hash: view.header.ruleset.definition_hash,
  definition: view.definition,
  state: view.state,
  interaction: view.interaction,
  events: (view.events || []).map((entry) => entry.event || entry),
  duplicate: view.duplicate || false,
});

export function createGamingApi() {
  return {
    getAssetPack: (packId) => request(`/api/v1/gaming/assets/${encodeURIComponent(packId)}`),
    getLaunchDescriptor: (gameId, surfaceId, authorityMode = null) => {
      const query = new URLSearchParams({ surface: surfaceId });
      if (authorityMode) query.set('authority', authorityMode);
      return request(`/api/v1/gaming/launch/${encodeURIComponent(gameId)}?${query}`);
    },
    async createSession(input) {
      return projectSession(await request('/api/v1/gaming/sessions', { method: 'POST', body: JSON.stringify({
        definition_id: input.game_id,
        surface_id: input.surface_id,
        participants: input.participants || [], setup: input.setup || {}, seed: input.seed,
      }) }), input.game_id);
    },
    async getSession(sessionId) {
      return projectSession(await request(`/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}`));
    },
    async applyCommand(sessionId, command, viewerId = null) {
      const envelope = {
        command_id: command.command_id,
        actor_id: viewerId || 'guest',
        expected_revision: command.session_revision,
        logical_time: performance.timeOrigin + performance.now(),
        correlation_id: `session:${sessionId}`,
        command: { type: command.type, payload: command.payload || {} },
      };
      return projectSession(await request(`/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}/commands`, { method: 'POST', body: JSON.stringify(envelope) }));
    },
  };
}
