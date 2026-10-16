import React, { useEffect, useMemo, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import NavRailSkeleton from './NavRailSkeleton.jsx';

/**
 * Shown while the fitness config loads. The app frame is already laid out
 * underneath (hidden), so a rail placeholder at the real navbar's position is
 * all that is needed: the rail hydrates in place and each screen widget then
 * shows its own skeleton. Replaces a "Loading fitness configuration…" page with
 * a big Reload button.
 *
 * Reload stays as the way out of a stuck load, but only appears once the load
 * has actually stalled — on a normal boot nobody sees it.
 */
export const RELOAD_OFFER_MS = 10_000;

export default function FitnessAppLoading({ onReload }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-app-loading' }), []);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setStalled(true);
      logger.warn('fitness.config-load.stalled', { afterMs: RELOAD_OFFER_MS });
    }, RELOAD_OFFER_MS);
    return () => clearTimeout(t);
  }, [logger]);

  return (
    <div className="fitness-app-loading" aria-busy="true">
      <NavRailSkeleton />
      {stalled && (
        <button
          type="button"
          className="fitness-app-loading__reload"
          onPointerDown={(e) => { e.preventDefault(); onReload?.(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReload?.(); } }}
        >
          Still loading — tap to reload
        </button>
      )}
    </div>
  );
}
