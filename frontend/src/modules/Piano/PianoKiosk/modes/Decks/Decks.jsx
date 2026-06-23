import { useEffect, useMemo } from 'react';
import getLogger from '../../../../../lib/logging/Logger.js';

/**
 * Decks — DJ-style loop & pad launcher (hybrid deck + pad bank), with a split
 * keyboard so the low keys finger-drum while the rest plays melodic over the mix.
 *
 * Phase 1 ships this placeholder so the tile/route exist and the menu stays at 8.
 * Phase 2 wires the Web Audio engine + pad bank + the `media/audio/dj` kit
 * adapter (see docs/_wip/plans/2026-06-23-decks-and-settings-panel-design.md).
 */
export function Decks() {
  const logger = useMemo(() => getLogger().child({ component: 'piano-decks' }), []);
  useEffect(() => { logger.info('piano.decks.mounted', {}); return () => logger.info('piano.decks.unmounted', {}); }, [logger]);

  return (
    <section className="piano-mode piano-decks">
      <div className="piano-decks__placeholder">
        <div className="piano-decks__platter" aria-hidden>
          <span className="piano-decks__spindle" />
        </div>
        <h2>Decks</h2>
        <p>Beats, loops & samples to jam over — coming together.</p>
        <p className="piano-decks__hint">Drop a kit (loops + one-shots + <code>kit.yml</code>) into <code>media/audio/dj</code> to load it here.</p>
      </div>
    </section>
  );
}

export default Decks;
