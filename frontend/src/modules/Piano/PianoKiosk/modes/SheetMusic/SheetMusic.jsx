import { useMemo, useState } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import ScoreGrid from './ScoreGrid.jsx';
import ScoreViewer from './ScoreViewer.jsx';

/**
 * Sheet Music mode — browse a Plex collection of scores and view them. Just
 * music to play (no lessons, no games). Two views: score grid → score viewer.
 * Collection from `sheetmusic.collection`.
 */
export function SheetMusic() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-sheetmusic' }), []);
  const { config } = usePianoKioskConfig();
  const collection = config.sheetmusic?.collection;
  const [score, setScore] = useState(null);

  if (score) {
    return <ScoreViewer score={score} onBack={() => { logger.info('piano.score-close', {}); setScore(null); }} />;
  }
  return <ScoreGrid collection={collection} onSelect={(item) => { logger.info('piano.score-select', { id: item.id }); setScore(item); }} />;
}

export default SheetMusic;
