import { useMemo } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import getLogger from '../../../../../lib/logging/Logger.js';
import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import LessonGrid from './LessonGrid.jsx';
import LessonDrill from './LessonDrill.jsx';

/**
 * Lessons mode — a generic, content-driven browser for technique-drill
 * collections. The active collection is a slug (config.lessons.collection)
 * pointing at media/docs/piano-lessons/{collection}/; ALL content (titles,
 * section labels, notes, fingering) lives in that collection's YAML. This
 * component knows nothing about Hanon specifically.
 *
 * Routed so the drill id lives in the URL (deep-linkable, survives reload,
 * physical/browser Back becomes an "up" gesture):
 *   index    → drill grid
 *   :drillId → single-drill view
 *
 * Navigation is RELATIVE so the mode works under /piano/* or /piano/:pianoId/*.
 */
export function Lessons() {
  const { config } = usePianoKioskConfig();
  const collection = config.lessons?.collection;
  return (
    <Routes>
      <Route index element={<LessonGridRoute collection={collection} />} />
      <Route path=":drillId" element={<LessonDrillRoute collection={collection} />} />
    </Routes>
  );
}

/** Drill grid → push the selected drill's id (relative). */
function LessonGridRoute({ collection }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-lessons' }), []);
  const navigate = useNavigate();
  return (
    <LessonGrid
      collection={collection}
      onSelect={(item) => {
        logger.info('piano.lesson-select', { collection, id: item.id });
        navigate(item.id);
      }}
    />
  );
}

/** Single-drill route — LessonDrill fetches its own module from the id. */
function LessonDrillRoute({ collection }) {
  const { drillId } = useParams();
  return <LessonDrill collection={collection} drillId={drillId} />;
}

export default Lessons;
