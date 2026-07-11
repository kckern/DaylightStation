export function buildScanUrl({ host, sectionId, token, forcePath }) {
  const base = `${host}/library/sections/${sectionId}/refresh`;
  const params = new URLSearchParams({ 'X-Plex-Token': token });
  if (forcePath) params.set('path', forcePath);
  return `${base}?${params.toString()}`;
}

export async function refreshSection({ host, sectionId, token, forcePath, fetchFn = fetch }) {
  const url = buildScanUrl({ host, sectionId, token, forcePath });
  const res = await fetchFn(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Plex refresh failed: ${res.status}`);
  return true;
}
