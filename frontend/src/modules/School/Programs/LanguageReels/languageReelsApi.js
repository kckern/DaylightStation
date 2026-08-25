const BASE = '/api/v1/school/language-reels';
const header = (grant) => ({ 'X-School-Reel-Grant': grant });
async function request(path, grant, body = undefined) {
  try {
    const response = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? header(grant) : { ...header(grant), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
  } catch { return { ok: false, status: 0, data: null }; }
}
export const languageReelsApi = {
  open: (userId, reelId, grant) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}`, grant),
  stage: (userId, reelId, stage, grant) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}/stages/${encodeURIComponent(stage)}`, grant, {}),
  attempt: (userId, reelId, grant, attempt) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}/attempts`, grant, attempt),
};
export default languageReelsApi;
