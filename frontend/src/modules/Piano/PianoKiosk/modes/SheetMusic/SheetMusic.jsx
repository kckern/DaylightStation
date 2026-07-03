import { useMemo, useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { DaylightAPIText } from '../../../../../lib/api.mjs';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import PianoEmpty from '../../PianoEmpty.jsx';
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

const NOTATION_RE = /\.(musicxml|mxl)$/i;

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
 * Score viewer route. The splat holds the full content id. A MusicXML id opens
 * the interactive engraved ScorePlayer (its raw XML is fetched here); anything
 * else (e.g. a Plex page-image score) opens the page-image ScoreViewer.
 */
function ScoreViewerRoute() {
  const params = useParams();
  const contentId = params['*'] || '';
  const imageScore = useMemo(() => ({ id: contentId }), [contentId]);
  if (NOTATION_RE.test(contentId)) return <NotationScore contentId={contentId} />;
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
  const localId = useMemo(() => contentId.replace(/^[a-z]+:/i, ''), [contentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        logger.info('piano.score-open', { id: localId, kind: 'notation' });
        const text = await DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localId)}`);
        if (!cancelled) setXml(text);
      } catch (err) {
        logger.warn('piano.score-open-failed', { id: localId, error: err.message });
        if (!cancelled) setXml('');
      }
    })();
    return () => { cancelled = true; };
  }, [localId, logger]);

  if (xml === null) return <PianoEmpty loading />;
  if (xml === '') return <PianoEmpty message="Could not load this score." />;
  return <ScorePlayer score={{ id: contentId, musicXml: xml }} />;
}

export default SheetMusic;
