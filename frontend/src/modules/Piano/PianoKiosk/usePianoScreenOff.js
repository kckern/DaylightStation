import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl } from './useScreenControl.js';
import { useScreenOffCooldown } from './usePianoScreensaverHooks.js';
import { usePianoUser } from './PianoUserContext.jsx';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * usePianoScreenOff — the shared "turn off the screen" action for the kiosk.
 *
 * Every entry point calls this so the behaviour is identical: the idle-gap
 * re-prompt, the player switcher, and Piano maintenance.
 * It turns the backlight off, arms the MIDI-wake cooldown, tells the device to
 * suppress wake across the cooldown window (so a played note won't re-light it),
 * and drops to Guest — turning the screen off means stepping away.
 *
 * The caller owns only its own modal state (closing the sheet afterward).
 *
 * @returns {() => Promise<object>} the structured screen-off result.
 */
export function usePianoScreenOff() {
  const { config } = usePianoKioskConfig();
  const { turnOffScreen } = useScreenControl();
  const beginScreenOffCooldown = useScreenOffCooldown();
  const { setCurrentUser } = usePianoUser();

  return useCallback(async () => {
    const minutes = config.screensaver?.offCooldownMinutes ?? 30;
    const screen = await turnOffScreen();
    if (screen?.ok === false) return { ...screen, wakeSuppression: 'skipped', guestReset: false };
    beginScreenOffCooldown();
    const deviceId = config.screensaver?.deviceId;
    let wakeSuppression = deviceId ? 'working' : 'not-configured';
    if (deviceId) {
      try {
        await DaylightAPI(`api/v1/device/${deviceId}/screen/suppress-wake`, { minutes }, 'POST');
        wakeSuppression = 'success';
      } catch (error) {
        wakeSuppression = 'failed';
        getLogger().child({ component: 'piano-screen-off' }).warn('piano.screen-off.suppress-wake-failed', { deviceId, error: error?.message });
      }
    }
    setCurrentUser('guest');
    return { ...screen, ok: true, wakeSuppression, guestReset: true };
  }, [config.screensaver, turnOffScreen, beginScreenOffCooldown, setCurrentUser]);
}

export default usePianoScreenOff;
