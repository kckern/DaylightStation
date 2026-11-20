import { useEffect, useState } from 'react';
import { peekApiResource, readApiResource, useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import { getChildLogger } from '../../../../frontend/src/lib/logging/singleton.js';
import { parseCatalogDescriptor, recentCatalogDescriptorOptions } from '../lib/catalogDescriptor.js';

function catalogContentInfo(value, parsed, data) {
  const { source, localId } = parsed;
  if (!data) return { value, title: localId, source, type: null, unresolved: true };

  const { metadata, thumbnail } = data;
  return {
    value,
    title: data.title || localId,
    source,
    type: metadata?.type || data.type || null,
    thumbnail,
    grandparent: metadata?.grandparentTitle,
    parent: metadata?.parentTitle,
    library: metadata?.librarySectionTitle,
    itemCount: metadata?.childCount ?? metadata?.leafCount ?? null,
    itemIndex: metadata?.itemIndex ?? null,
    number: metadata?.number ?? null,
    unresolved: false,
  };
}

async function resolveAppContentInfo(value) {
  const { resolveAppDisplay, getApp } = await import('../../../../frontend/src/lib/appRegistry.js');
  const appInfo = resolveAppDisplay(value);
  if (!appInfo) return { value, title: value.slice(4), source: 'app', type: null, unresolved: true };
  return {
    value,
    title: appInfo.paramValue ? `${appInfo.label} / ${appInfo.paramValue}` : appInfo.label,
    source: 'app',
    type: 'app',
    thumbnail: getApp(appInfo.appId)?.icon || null,
    unresolved: false,
  };
}

export function useCatalogContentInfo(value, pickedInfo) {
  const isApp = value?.startsWith('app:');
  const descriptor = isApp ? null : parseCatalogDescriptor(value);
  const { data, loading } = useApiResource(descriptor?.path, recentCatalogDescriptorOptions);
  const [appInfo, setAppInfo] = useState(null);
  useEffect(() => {
    if (!isApp || pickedInfo) return undefined;
    let current = true;
    resolveAppContentInfo(value).then(info => { if (current) setAppInfo(info); });
    return () => { current = false; };
  }, [value, isApp, pickedInfo]);

  if (!value) return null;
  if (descriptor) {
    if (data) return catalogContentInfo(value, descriptor, data);
    return pickedInfo ?? (loading ? undefined : catalogContentInfo(value, descriptor, null));
  }
  if (pickedInfo) return pickedInfo;
  if (isApp) return appInfo?.value === value ? appInfo : undefined;
  return { value, unresolved: true };
}

export function getCachedCatalogContentInfo(value, pickedInfo) {
  const descriptor = value?.startsWith('app:') ? null : parseCatalogDescriptor(value);
  const data = peekApiResource(descriptor?.path);
  return data ? catalogContentInfo(value, descriptor, data) : pickedInfo;
}

export async function fetchContentMetadata(value) {
  if (!value) return null;
  if (value.startsWith('app:')) return resolveAppContentInfo(value);

  const descriptor = parseCatalogDescriptor(value);
  if (!descriptor) return { value, unresolved: true };
  try {
    const data = await readApiResource(descriptor.path, recentCatalogDescriptorOptions);
    return catalogContentInfo(value, descriptor, data);
  } catch (err) {
    const log = getChildLogger({ app: 'admin', component: 'fetchContentMetadata', sessionLog: true });
    if (err.status >= 400) log.warn('content_api.error_status', { value, status: err.status });
    else if (err.name !== 'AbortError') log.error('content_info.fetch_error', { value, error: err.message });
    return catalogContentInfo(value, descriptor, null);
  }
}
