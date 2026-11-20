import { contentInfoPath, splitContentId } from './contentSearchLogic.js';

export const catalogDescriptorOptions = { swr: true, timeoutMs: 5000, retryTransient: false };
export const recentCatalogDescriptorOptions = { ...catalogDescriptorOptions, freshMs: 60_000 };

export function parseCatalogDescriptor(value) {
  const parsed = splitContentId(value);
  const path = contentInfoPath(parsed?.source, parsed?.localId);
  return path ? { ...parsed, path } : null;
}
