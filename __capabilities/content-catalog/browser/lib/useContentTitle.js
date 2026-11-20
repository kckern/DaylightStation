import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { parseCatalogDescriptor, recentCatalogDescriptorOptions } from './catalogDescriptor.js';

const TITLE_CACHE_MAX = 500;
// Keep titles supplied by search picks available before a descriptor is read.
const titleCache = new Map();

export function clearTitleCache() {
  titleCache.clear();
}

export function rememberTitle(contentId, title) {
  if (!contentId || !title) return;
  if (titleCache.size > TITLE_CACHE_MAX) titleCache.clear();
  titleCache.set(contentId, title);
}

export function useContentTitle(contentId) {
  const cached = contentId ? titleCache.get(contentId) : null;
  const path = cached ? null : parseCatalogDescriptor(contentId)?.path;
  const { data } = useApiResource(path, { ...recentCatalogDescriptorOptions, retryTransient: true });
  return cached || data?.title || null;
}
