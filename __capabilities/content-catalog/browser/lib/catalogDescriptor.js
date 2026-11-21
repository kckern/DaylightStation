import { splitContentId } from './contentSearchLogic.js';

export const catalogDescriptorOptions = { swr: true, timeoutMs: 5000, retryTransient: false };
export const recentCatalogDescriptorOptions = { ...catalogDescriptorOptions, freshMs: 60_000 };

const infoPath = '/api/v1/info';

export function parseCatalogDescriptor(value, { allowUnqualified = false } = {}) {
  const parsed = splitContentId(value);
  if (parsed?.source && parsed.localId) {
    return { ...parsed, path: `${infoPath}/${encodeURIComponent(parsed.source)}/${encodeURIComponent(parsed.localId)}` };
  }
  if (!parsed && allowUnqualified && typeof value === 'string' && value.trim()) {
    const localId = value.trim();
    // Legacy display IDs can be bare values or slash-separated source paths.
    // Keep the boundaries intact so the server can interpret either form.
    const encodedPath = localId.split('/').map(encodeURIComponent).join('/');
    return { source: null, localId, path: `${infoPath}/${encodedPath}` };
  }
  return null;
}
