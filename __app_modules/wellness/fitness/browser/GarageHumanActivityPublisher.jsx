import { useEffect, useMemo, useRef } from 'react';
import { DaylightAPI } from "../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../frontend/src/lib/logging/Logger.js";
import { useFitnessSelector } from "./context/FitnessContext.jsx";

/** Keeps Home Assistant's garage shutdown guard aligned with this kiosk. */
export function GarageHumanActivityPublisher({ deviceId, emulationOpen }) {
  // Three booleans, selected: this publisher must not re-render on every
  // sensor update, only when one of them flips.
  const { sessionActive, emulatorInContext, liveHrParticipant } = useFitnessSelector((fitness) => ({
    sessionActive: Boolean(fitness?.isSessionActive),
    emulatorInContext: fitness?.activeApp?.id === 'emulator' || fitness?.overlayApp?.id === 'emulator',
    liveHrParticipant: fitness?.activeHeartRateParticipants?.some((participant) => participant.isActive !== false) ?? false,
  }));
  const logger = useMemo(() => getLogger().child({ component: 'garage-human-activity' }), []);
  const hadHrParticipant = useRef(false);
  const firstReport = useRef(true);
  const pending = useRef(Promise.resolve());
  const emulatorActive = Boolean(emulationOpen || emulatorInContext);

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
