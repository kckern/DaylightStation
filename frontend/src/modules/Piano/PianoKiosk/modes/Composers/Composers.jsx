import { useEffect, useMemo } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

/**
 * Composers — placeholder mode. Will become an educational reference on the
 * great composers; for now it just announces itself.
 */
export function Composers() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-composers' }), []);
  useEffect(() => { logger.info('piano.composers.mounted', {}); }, [logger]);

  return (
    <section className="piano-mode piano-mode--composers">
      <h2>Composers</h2>
      <p className="piano-mode__placeholder">
        Coming soon — an educational reference on the great composers.
      </p>
    </section>
  );
}

export default Composers;
