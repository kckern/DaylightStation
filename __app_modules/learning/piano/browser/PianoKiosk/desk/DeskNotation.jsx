import { useEffect, useState } from 'react';
import { DaylightAPIText } from '../../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import ScorePassage from '../modes/Exercises/ScorePassage.jsx';
import '../modes/Exercises/Exercises.scss';
import { scoreHeading } from './deskModel.js';

const scores = new Map();

function loadScore(scoreId) {
  if (!scores.has(scoreId)) {
    const localId = scoreId.replace(/^[a-z]+:/i, '');
    const request = DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(localId)}`);
    request.catch(() => scores.delete(scoreId));
    scores.set(scoreId, request);
  }
  return scores.get(scoreId);
}

/** The next passage in real notation. Loaded separately so the menu paints first. */
export default function DeskNotation({ scoreId, passage, onHeading }) {
  const [xml, setXml] = useState(null);
  useEffect(() => {
    let live = true;
    setXml(null);
    loadScore(scoreId).then((text) => {
      if (!live) return;
      setXml(text);
      onHeading?.(scoreHeading(text));
    }).catch((error) => {
      getLogger().child({ component: 'piano-desk' }).warn('piano.desk.score-failed', { scoreId, error: error.message });
    });
    return () => { live = false; };
  }, [scoreId, onHeading]);
  if (!xml || !passage) return null;
  return (
    <div className="piano-desk__notation piano-exercise-run__score">
      <ScorePassage key={`${scoreId}:${passage.id}`} musicXml={xml} sourceId={scoreId} keepWholePassage
        rangeIndices={{ start: passage.start, end: passage.end }} />
    </div>
  );
}
