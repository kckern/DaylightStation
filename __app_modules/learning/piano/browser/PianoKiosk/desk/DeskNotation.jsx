import { memo, useEffect, useMemo, useState } from 'react';
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
function DeskNotation({ scoreId, passage, onHeading }) {
  const [xml, setXml] = useState(null);
  const [failed, setFailed] = useState(false);
  const start = passage?.start; const end = passage?.end;
  const range = useMemo(() => ({ start, end }), [start, end]);
  useEffect(() => {
    let live = true;
    setXml(null);
    setFailed(false);
    loadScore(scoreId).then((text) => {
      if (!live) return;
      setXml(text);
      onHeading?.(scoreHeading(text));
    }).catch((error) => {
      getLogger().child({ component: 'piano-desk' }).warn('piano.desk.score-failed', { scoreId, error: error.message });
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [scoreId, onHeading]);
  if (failed) return <p className="piano-desk__notation-error">The music could not load. You can still continue.</p>;
  if (!xml || !passage) return null;
  return (
    <div className="piano-desk__notation piano-exercise-run__score">
      <ScorePassage key={`${scoreId}:${passage.id}`} musicXml={xml} sourceId={scoreId} keepWholePassage
        rangeIndices={range} />
    </div>
  );
}

export default memo(DeskNotation);
