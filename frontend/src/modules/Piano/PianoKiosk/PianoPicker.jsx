import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoRoster } from './PianoConfig.jsx';

/**
 * PianoPicker — household has multiple piano kiosks; pick which one this is.
 * With exactly one piano, auto-enters it (a dedicated kiosk shouldn't ask).
 */
export function PianoPicker() {
  const { loading, pianos } = usePianoRoster();
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ component: 'piano-picker' }), []);

  useEffect(() => {
    if (!loading && pianos.length === 1) {
      navigate(`/piano/${pianos[0].id}`, { replace: true });
    }
  }, [loading, pianos, navigate]);

  if (loading) return <div className="piano-connect-gate"><p>Loading…</p></div>;
  if (pianos.length === 1) return null; // redirecting

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
            <button type="button" className="piano-menu__tile" onClick={() => open(p.id)}>
              <span className="piano-menu__tile-icon" aria-hidden>🎹</span>
              <span className="piano-menu__tile-label">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default PianoPicker;
