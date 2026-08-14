async function request(url) {
  const response = await fetch(url); const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || `Presentation request failed (${response.status})`), { status: response.status, code: body.error });
  return body;
}

export function createPresentationApi() {
  return {
    getCatalog(packId) {
      return request(`/api/v1/presentation/catalogs/${encodeURIComponent(packId)}`);
    },
    getScenes(packId) {
      return request(`/api/v1/presentation/catalogs/${encodeURIComponent(packId)}/scenes`);
    },
    getScene(packId, sceneId) {
      return request(`/api/v1/presentation/catalogs/${encodeURIComponent(packId)}/scenes/${encodeURIComponent(sceneId)}`);
    },
  };
}
