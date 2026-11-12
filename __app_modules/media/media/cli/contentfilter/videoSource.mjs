/**
 * Where refine reads a film from. Streaming the original through Plex costs minutes per cue
 * (every probe decodes up to ~30 s of 1080p over HTTPS), so the order is:
 *   1. --src
 *   2. the part's own file, through CONTENT_FILTER_PATH_MAP (Plex's path -> this host's path)
 *   3. a 240p Plex stream, when CONTENT_FILTER_LOW_RES=1 (region boxes are fractions of the frame)
 *   4. the original through Plex, as before
 * Pure: the caller passes `exists`.
 */

/** "from=to;from=to" -> [{ from, to }], longest `from` first so the most specific prefix wins. */
export function parsePathMap(text) {
  return String(text || '').split(';')
    .map((pair) => pair.split('=').map((s) => s.trim()))
    .filter(([from, to]) => from && to)
    .map(([from, to]) => ({ from: from.replace(/\/+$/, ''), to: to.replace(/\/+$/, '') }))
    .sort((a, b) => b.from.length - a.from.length);
}

function mapPath(file, pathMap) {
  const hit = pathMap.find(({ from }) => file === from || file.startsWith(`${from}/`));
  return hit ? hit.to + file.slice(hit.from.length) : null;
}

export function lowResUrl({ rk, host, token }) {
  const q = new URLSearchParams({
    path: `/library/metadata/${rk}`, mediaIndex: '0', partIndex: '0', protocol: 'http',
    directPlay: '0', directStream: '0', videoResolution: '426x240', maxVideoBitrate: '400', audioCodec: 'aac', 'X-Plex-Token': token,
  });
  return `${host}/video/:/transcode/universal/start.mkv?${q}`;
}

/**
 * @returns {{ src: string, kind: 'flag'|'local'|'plex-240p'|'plex-direct', reason?: string }}
 */
export function chooseVideoSource({ rk, part, host, token, flagSrc = null, pathMap = [], exists = () => false, lowRes = false }) {
  if (flagSrc) return { kind: 'flag', src: flagSrc };
  let reason;
  if (!part?.file) reason = 'no-file';
  else if (!pathMap.length) reason = 'no-map';
  else {
    const local = mapPath(part.file, pathMap);
    if (!local) reason = 'no-map';
    else if (exists(local)) return { kind: 'local', src: local };
    else reason = 'missing-file';
  }
  if (lowRes) return { kind: 'plex-240p', src: lowResUrl({ rk, host, token }), reason };
  return { kind: 'plex-direct', src: `${host}${part.key}?X-Plex-Token=${token}`, reason };
}
