// sheetMusicModel.js — content-id/collection resolution for SheetMusic.jsx,
// split out so Fast Refresh can hot-reload the mode's routes on their own.
import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';

// Both .musicxml and .mxl open in the engraved player. .mxl is a ZIP container,
// but the backend media/stream endpoint decompresses it on the fly (reads
// META-INF/container.xml → rootfile via extractMusicXmlFromMxl) and returns plain
// MusicXML text, so the engrave pipeline receives raw XML either way (audit H4).
const NOTATION_RE = /\.(musicxml|mxl)$/i;

/** True when a content id should open in the engraved (MusicXML) player. */
export function isNotationId(id) {
  return NOTATION_RE.test(String(id || ''));
}

/**
 * Map a configured collection ref to a generic list path. Supports source-prefixed
 * refs (`files:docs/sheet-music`, `plex:359812`) and bare Plex ids (legacy).
 */
export function collectionListPath(ref) {
  if (!ref) return null;
  const s = String(ref).trim();
  const i = s.indexOf(':');
  const source = i > 0 ? s.slice(0, i) : 'plex';
  const id = i > 0 ? s.slice(i + 1) : s;
  return `api/v1/list/${source}/${id}`;
}

/** Split a content id into { source, localId }. Bare ids default to plex (legacy). */
export function splitSourceId(id) {
  const s = String(id || '').trim();
  const i = s.indexOf(':');
  if (i <= 0) return { source: 'plex', localId: s };
  return { source: s.slice(0, i), localId: s.slice(i + 1) };
}

/**
 * Resolve a score's sidecar/cover image up front (via its `info`), so the viewer can
 * prefer a curated scan — a same-basename image like fur-elise.jpg next to the score —
 * over engraving. A failed/absent info degrades to no image (→ engrave / plex path).
 * Returns { loading, image, title }.
 */
export function useScoreImage(contentId) {
  const [state, setState] = useState({ loading: true, image: null, title: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, image: null, title: null });
    const { source, localId } = splitSourceId(contentId);
    (async () => {
      const info = await Promise.resolve(DaylightAPI(`api/v1/info/${source}/${localId}`)).catch(() => null);
      if (cancelled) return;
      setState({ loading: false, image: info?.image || info?.thumbnail || null, title: info?.title || null });
    })();
    return () => { cancelled = true; };
  }, [contentId]);
  return state;
}
