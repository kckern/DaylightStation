/**
 * Shared construction of the stream-proxy URL so direct media URLs (googlevideo,
 * CDN m3u8, …) are fetched server-side — sidestepping IP-lock / CORS in the
 * browser. Used by StreamAdapter and the youtube content source.
 */
export const STREAM_PROXY_PATH = '/api/v1/proxy/stream';

export function proxifyStreamUrl(mediaUrl, profileName) {
  const q = new URLSearchParams({ src: mediaUrl });
  if (profileName) q.set('profile', profileName);
  return `${STREAM_PROXY_PATH}?${q.toString()}`;
}
