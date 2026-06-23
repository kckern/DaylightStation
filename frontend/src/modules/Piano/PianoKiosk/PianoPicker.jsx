import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoRoster } from './PianoConfig.jsx';
import PianoTile from './PianoTile.jsx';

/**
 * PianoPicker — household has multiple piano kiosks; pick which one this is.
 * Only rendered for 2+ pianos: the single/default piano serves directly under
 * /piano (the route branch in PianoApp skips the picker entirely).
 */
export function PianoPicker() {
  const { loading, pianos } = usePianoRoster();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'piano-picker' }), []);

  if (loading) return <div className="piano-connect-gate"><p>Loading…</p></div>;

  const open = (id) => {
    logger.info('piano.select-instrument', { pianoId: id });
    navigate(`/piano/${id}`);
  };

  return (
    <main className="piano-menu">
      <h1 className="piano-picker__title">Which piano?</h1>
      <ul className="piano-menu__tiles">
        {pianos.map((p) => (
          <li key={p.id}>
            <PianoTile icon="music" label={p.label} onClick={() => open(p.id)} />
          </li>
        ))}
      </ul>
    </main>
  );
}

export default PianoPicker;
