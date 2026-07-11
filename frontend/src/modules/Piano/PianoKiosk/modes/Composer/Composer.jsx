import { useEffect, useMemo } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

/**
 * Composer — placeholder mode. Will become a composition tool for writing and
 * arranging music at the piano; for now it just announces itself. Distinct from
 * the Composers educational-reference mode (great composers).
 */
export function Composer() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-composer' }), []);
  useEffect(() => { logger.info('piano.composer.mounted', {}); }, [logger]);

  return (
    <section className="piano-mode piano-mode--composer">
      <h2>Composer</h2>
      <p className="piano-mode__placeholder">
        Coming soon — a tool to write and arrange your own music.
      </p>
    </section>
  );
}

export default Composer;
