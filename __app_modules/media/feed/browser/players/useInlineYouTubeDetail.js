import { useApiResource } from '../../../../../frontend/src/lib/hooks/useApiResource.js';

export const INLINE_YOUTUBE_QUALITY = '720p';

export function inlineYouTubeDetailPath(itemId, videoId) {
  const params = new URLSearchParams({
    quality: INLINE_YOUTUBE_QUALITY,
    meta: JSON.stringify({ videoId }),
  });
  return `/api/v1/feed/detail/${encodeURIComponent(itemId)}?${params}`;
}

export function useInlineYouTubeDetail(path) {
  // Stream URLs can expire and the detail response provides no expiry time.
  const { data, loading, error } = useApiResource(path, {
    label: 'Feed inline YouTube detail',
    retryTransient: false,
  });
  const sections = !loading && !error && Array.isArray(data?.sections) ? data.sections : [];
  const playerData = sections.find(section => section?.type === 'player' && section.data?.provider === 'youtube')?.data;
  return { playerData, loading, error, sectionCount: sections.length };
}
