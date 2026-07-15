import { useMemo, useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPIText, DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
import { SkeletonStage } from '../../Skeleton.jsx';
import ScoreGrid from './ScoreGrid.jsx';
import ScoreViewer from './ScoreViewer.jsx';
import ScorePlayer from './ScorePlayer.jsx';

/**
 * Sheet Music mode — browse a folder of scores and view them.
 *
 * Scores live as files under the media tree (e.g. media/docs/sheet-music/) and
 * are listed by the generic content API. MusicXML files (.musicxml/.mxl) are
 * engraved interactively by ScorePlayer; scanned page-image scores (e.g. a Plex
 * collection) fall back to ScoreViewer's image pages.
 *
 * Routed so the score id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index      → score grid
 *   view/*     → score viewer (splat holds the full content id, which may
 *                contain slashes, e.g. files:docs/sheet-music/fur-elise.musicxml)
 *
 * All navigation is RELATIVE (navigate('view/…') / navigate('..')) so the mode
 * works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * The score source comes from piano config `sheetmusic.collection`.
 */

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

export function SheetMusic() {
  const { config } = usePianoKioskConfig();
  const ref = config.sheetmusic?.collection;
  return (
    <Routes>
      <Route index element={<ScoreGridRoute collectionRef={ref} />} />
      <Route path="view/*" element={<ScoreViewerRoute />} />
    </Routes>
  );
}

/** Score grid → push the selected score's content id (relative). */
function ScoreGridRoute({ collectionRef }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const navigate = useNavigate();
  return (
    <ScoreGrid
      listPath={collectionListPath(collectionRef)}
      onSelect={(item) => {
        logger.info('piano.score-select', { id: item.id });
        // The id can contain slashes (a file path); they become real path
        // segments under view/* and round-trip via the splat param.
        navigate(`view/${item.id}`);
      }}
    />
  );
}

/**
 * Score viewer route. The splat holds the full content id. A curated sidecar image
 * (a same-basename .jpg scan) wins — it opens in the page-image ScoreViewer. Failing
 * that, a MusicXML id (.musicxml/.mxl) opens the interactive engraved ScorePlayer;
 * anything else (e.g. a Plex page-image score) opens the page-image ScoreViewer.
 */
function ScoreViewerRoute() {
  const params = useParams();
  const contentId = params['*'] || '';
  const { loading, image, title } = useScoreImage(contentId);
  const imageScore = useMemo(() => ({ id: contentId, image, title }), [contentId, image, title]);
  if (loading) return <SkeletonStage />;
  if (image) return <ScoreViewer score={imageScore} />;
  if (isNotationId(contentId)) return <NotationScore contentId={contentId} />;
  return <ScoreViewer score={imageScore} />;
}

/**
 * Fetches a MusicXML file's raw contents from the media stream endpoint, then
 * hands it to ScorePlayer to engrave. ScorePlayer derives title/composer/tempo
 * from the embedded XML, so no extra metadata is needed here.
 */
function NotationScore({ contentId }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const [xml, setXml] = useState(null); // null = loading, '' = failed
  const [retryKey, setRetryKey] = useState(0);
  const fetchMsRef = useRef(0); // raw-XML fetch time → ScorePlayer's score.load telemetry
  const localId = useMemo(() => contentId.replace(/^[a-z]+:/i, ''), [contentId]);

  useEffect(() => {
    let cancelled = false;
    setXml(null);
    (async () => {
      try {
        logger.info('piano.score-open', { id: localId, kind: 'notation' });
        const t0 = performance.now();
        const text = await DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localId)}`);
        fetchMsRef.current = performance.now() - t0;
        if (!cancelled) setXml(text);
      } catch (err) {
        logger.warn('piano.score-open-failed', { id: localId, error: err.message });
        if (!cancelled) setXml('');
      }
    })();
    return () => { cancelled = true; };
  }, [localId, logger, retryKey]);

  if (xml === null) return <SkeletonStage />;
  if (xml === '') return <PianoEmpty message="Could not load this score." actionLabel="Try again" onAction={() => setRetryKey((k) => k + 1)} />;
  return <ScorePlayer score={{ id: contentId, musicXml: xml, fetchMs: fetchMsRef.current }} />;
}

export default SheetMusic;
