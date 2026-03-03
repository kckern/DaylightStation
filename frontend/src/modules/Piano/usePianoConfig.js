import { useState, useEffect, useRef, useMemo } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { DaylightAPI } from '../../lib/api.mjs';

const ON_OPEN_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
let lastOnOpenTime = 0;

/**
 * Loads piano config (device config + app config) and manages HA script lifecycle.
 *
 * @returns {{ gamesConfig: Object|null }}
 */
export function usePianoConfig() {
  const logger = useMemo(() => getChildLogger({ component: 'piano-config' }), []);
  const [gamesConfig, setGamesConfig] = useState(null);
  const pianoConfigRef = useRef(null);

  useEffect(() => {
    const initPiano = async () => {
      try {
        const devicesConfig = await DaylightAPI('api/v1/device/config');
        const pianoConfig = devicesConfig?.devices?.['office-tv']?.modules?.['piano-visualizer'] ?? {};
        pianoConfigRef.current = pianoConfig;

        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gamesC = pianoAppConfig?.parsed?.games ?? null;
          setGamesConfig(gamesC);
        } catch (err) {
          // Game mode unavailable
        }

        if (pianoConfig?.on_open) {
          const now = Date.now();
          if (now - lastOnOpenTime < ON_OPEN_DEBOUNCE_MS) {
            logger.debug('ha.on-open-debounced', {
              scriptId: pianoConfig.on_open,
              lastCalledSecsAgo: Math.round((now - lastOnOpenTime) / 1000),
            });
          } else {
            lastOnOpenTime = now;
            DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST')
              .then(() => logger.debug('ha.on-open-executed', { scriptId: pianoConfig.on_open }))
              .catch(err => logger.warn('ha.on-open-failed', { error: err.message }));
          }
        }
      } catch (err) {
        logger.warn('config-load-failed', { error: err.message });
      }
    };
    initPiano();

    return () => {
      const config = pianoConfigRef.current;
      if (config?.on_close) {
        DaylightAPI(`/api/v1/home/ha/script/${config.on_close}`, {}, 'POST')
          .catch(err => logger.warn('ha.on-close-failed', { error: err.message }));
      }
    };
  }, [logger]);

  return { gamesConfig };
}
