import { useMemo } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import ScoreGrid from './ScoreGrid.jsx';
import ScoreViewer from './ScoreViewer.jsx';

/**
 * Sheet Music mode — browse a Plex collection of scores and view them.
 *
 * Routed so the score id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index      → score grid
 *   :scoreId   → score viewer
 *
 * All navigation is RELATIVE (navigate('subpath') / navigate('..')) so the
 * mode works under either /piano/* (single piano) or /piano/:pianoId/* (multi).
 * Collection id comes from piano config `sheetmusic.collection`.
 */
export function SheetMusic() {
  const { config } = usePianoKioskConfig();
  const collection = config.sheetmusic?.collection;
  return (
    <Routes>
      <Route index element={<ScoreGridRoute collection={collection} />} />
      <Route path=":scoreId" element={<ScoreViewerRoute />} />
    </Routes>
  );
}

/** Score grid → push the selected score id (relative). */
function ScoreGridRoute({ collection }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const navigate = useNavigate();
  const idOf = (raw) => String(raw || '').replace(/^plex:/, '');
  return (
    <ScoreGrid
      collection={collection}
      onSelect={(item) => {
        logger.info('piano.score-select', { id: item.id });
        navigate(idOf(item.id));
      }}
    />
  );
}

/**
 * Score viewer route. Passes a minimal score object with just the id so a cold
 * deep-link works — ScoreViewer fetches its own page list from score.id. The
 * title/alt fall back to 'Score' which is acceptable on cold load.
 */
function ScoreViewerRoute() {
  const { scoreId } = useParams();
  const navigate = useNavigate();
  const score = useMemo(() => ({ id: scoreId }), [scoreId]);
  // ScoreViewer logs `piano.score-open` from its own effect — no duplicate here.
  return (
    <ScoreViewer
      score={score}
      onBack={() => navigate('..')}
    />
  );
}

export default SheetMusic;
