import { useEffect, useMemo, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { useFitnessContext } from '../../context/FitnessContext.jsx';

/** Keeps Home Assistant's garage shutdown guard aligned with this kiosk. */
export function GarageHumanActivityPublisher({ deviceId, emulationOpen }) {
  const fitness = useFitnessContext();
  const logger = useMemo(() => getLogger().child({ component: 'garage-human-activity' }), []);
  const hadHrParticipant = useRef(false);
  const firstReport = useRef(true);
  const pending = useRef(Promise.resolve());
  const sessionActive = Boolean(fitness?.isSessionActive);
  const emulatorActive = Boolean(emulationOpen || fitness?.activeApp?.id === 'emulator' || fitness?.overlayApp?.id === 'emulator');
  const liveHrParticipant = fitness?.activeHeartRateParticipants?.some((participant) => participant.isActive !== false) ?? false;

  // A brief strap dropout does not mean the workout ended. The session end is
  // the authority for releasing HR protection.
  if (!sessionActive) hadHrParticipant.current = false;
  else if (liveHrParticipant) hadHrParticipant.current = true;
  const hrSessionActive = sessionActive && hadHrParticipant.current;

  useEffect(() => {
    if (deviceId !== 'garage-tv') return undefined;
    const payload = { deviceId, emulationOpen: emulatorActive, hrSessionActive };
    const active = payload.emulationOpen || payload.hrSessionActive;
    const publish = () => {
      pending.current = pending.current.catch(() => {}).then(() => DaylightAPI('api/v1/fitness/garage-human-activity', payload, 'POST'));
      pending.current
        .then(() => logger.info('fitness.garage_human_activity.published', payload))
        .catch((error) => logger.warn('fitness.garage_human_activity.publish_failed', { ...payload, error: error?.message }));
    };
    // On a reload, context restoration may briefly look idle even though the
    // kiosk is returning to a game or workout. Keep HA's fail-safe guard until
    // the first inactive snapshot has had time to hydrate.
    const initialDelay = firstReport.current && !active ? 10_000 : 0;
    firstReport.current = false;
    const timeout = initialDelay ? setTimeout(publish, initialDelay) : null;
    if (!timeout) publish();
    const interval = setInterval(publish, 60_000);
    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [deviceId, emulatorActive, hrSessionActive, logger]);

  return null;
}
