async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Gaming request failed (${response.status})`);
    error.status = response.status;
    error.code = body.error;
    error.details = body.details;
    throw error;
  }
  return body;
}

export function createGamingApi() {
  return {
    getDefinition(gameId) {
      return request(`/api/v1/gaming/definitions/${encodeURIComponent(gameId)}`);
    },
    getProgress(gameId, userId) {
      return request(`/api/v1/gaming/games/${encodeURIComponent(gameId)}/progress?user_id=${encodeURIComponent(userId)}`);
    },
    getActiveSession(gameId, userId) {
      return request(`/api/v1/gaming/games/${encodeURIComponent(gameId)}/active-session?user_id=${encodeURIComponent(userId)}`);
    },
    getLeaderboard(gameId, userId, week = null) {
      const params = new URLSearchParams({ user_id: userId });
      if (week) params.set('week', week);
      return request(`/api/v1/gaming/games/${encodeURIComponent(gameId)}/leaderboard?${params}`);
    },
    createSession(input) {
      return request('/api/v1/gaming/sessions', { method: 'POST', body: JSON.stringify(input) });
    },
    getSession(sessionId, viewerId = null) {
      const query = viewerId ? `?viewer_id=${encodeURIComponent(viewerId)}` : '';
      return request(`/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}${query}`);
    },
    applyCommand(sessionId, command, viewerId = null) {
      return request(`/api/v1/gaming/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        body: JSON.stringify({ command, viewer_id: viewerId }),
      });
    },
    recordPianoAttempt(userId, attempt) {
      return request(`/api/v1/piano/users/${encodeURIComponent(userId)}/attempts`, {
        method: 'POST',
        body: JSON.stringify(attempt),
      });
    },
    preparePianoChallenge(userId, requestBody) {
      return request(`/api/v1/piano/users/${encodeURIComponent(userId)}/challenges/prepare`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
    },
  };
}
