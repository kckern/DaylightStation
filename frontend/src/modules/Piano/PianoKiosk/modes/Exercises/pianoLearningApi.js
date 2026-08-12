async function request(path, { method = 'GET', body } = {}) {
  try {
    const response = await fetch(`/api/v1/piano/${path.replace(/^\//, '')}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export const pianoLearningApi = {
  catalog: () => request('bank/catalog'),
  learning: (userId) => request(`users/${encodeURIComponent(userId || 'guest')}/learning`),
  program: (programId) => request(`programs/${encodeURIComponent(programId)}`),
  seed: (seedId) => request(`bank/${seedId.split('/').map(encodeURIComponent).join('/')}`),
  instances: (seedId) => request(`bank/${seedId.split('/').map(encodeURIComponent).join('/')}/instances?expand=true&limit=2000`),
  instance: (instanceId) => {
    const [seedId, axes] = instanceId.split('@');
    const query = axes ? `?${axes.split(',').map((pair) => pair.split('=').map(encodeURIComponent).join('=')).join('&')}` : '';
    return request(`bank/${seedId.split('/').map(encodeURIComponent).join('/')}/instance${query}`);
  },
  enroll: (userId, programId) => request(
    `users/${encodeURIComponent(userId)}/enrollments/${encodeURIComponent(programId)}`,
    { method: 'PUT', body: {} },
  ),
  unenroll: (userId, programId) => request(
    `users/${encodeURIComponent(userId)}/enrollments/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
  ),
  rememberCheckpoint: (userId, contentId, body) => request(
    `users/${encodeURIComponent(userId)}/pending-checkpoints/${encodeURIComponent(contentId)}`,
    { method: 'PUT', body },
  ),
  attempts: (userId, exerciseId = null) => {
    const query = exerciseId ? `?exercise_id=${encodeURIComponent(exerciseId)}` : '';
    return request(`users/${encodeURIComponent(userId)}/attempts${query}`);
  },
  recordAttempt: (userId, attempt, { keepalive = false } = {}) => {
    if (keepalive) {
      return fetch(`/api/v1/piano/users/${encodeURIComponent(userId)}/attempts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt), keepalive: true,
      }).then(async (response) => ({ ok: response.ok, status: response.status, data: await response.json().catch(() => null) }))
        .catch(() => ({ ok: false, status: 0, data: null }));
    }
    return request(`users/${encodeURIComponent(userId)}/attempts`, { method: 'POST', body: attempt });
  },
  assignments: (userId) => request(`users/${encodeURIComponent(userId)}/program-assignments`),
  putAssignments: (userId, body) => request(`users/${encodeURIComponent(userId)}/program-assignments`, { method: 'PUT', body }),
  programs: () => request('programs'),
};

export default pianoLearningApi;
