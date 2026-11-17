import { createSchoolEndpointClient } from '../../runtime/schoolEndpointClient.js';

export function createLanguageReelsApi(options = {}) {
  const client = createSchoolEndpointClient({ ...options, base: '/api/v1/school/language-reels' });
  const request = async (path, grant, body) => client.finish(await client.request(path, { body, headers: { 'X-School-Reel-Grant': grant } }));
  return {
  open: (userId, reelId, grant) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}`, grant),
  stage: (userId, reelId, stage, grant) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}/stages/${encodeURIComponent(stage)}`, grant, {}),
  attempt: (userId, reelId, grant, attempt) => request(`/users/${encodeURIComponent(userId)}/reels/${encodeURIComponent(reelId)}/attempts`, grant, attempt),
};
}
export const languageReelsApi = createLanguageReelsApi();
export default languageReelsApi;
