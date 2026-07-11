import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { useScreenControl } from './useScreenControl.js';
import { useScreenOffCooldown } from './usePianoScreensaver.jsx';
import { usePianoUser } from './PianoUserContext.jsx';

/**
 * usePianoScreenOff — the shared "turn off the screen" action for the kiosk.
 *
 * Both entry points call this so the behaviour is identical: the idle-gap
 * re-prompt (PianoApp) and the chrome chip's manual switcher (PianoUserChip).
 * It turns the backlight off, arms the MIDI-wake cooldown, tells the device to
 * suppress wake across the cooldown window (so a played note won't re-light it),
 * and drops to Guest — turning the screen off means stepping away.
 *
 * The caller owns only its own modal state (closing the sheet afterward).
 *
 * @returns {() => Promise<void>} the screen-off action.
 */
export function usePianoScreenOff() {
  const { config } = usePianoKioskConfig();
  const { turnOffScreen } = useScreenControl();
  const beginScreenOffCooldown = useScreenOffCooldown();
  const { setCurrentUser } = usePianoUser();

  return useCallback(async () => {
    const minutes = config.screensaver?.offCooldownMinutes ?? 30;
    await turnOffScreen();
    beginScreenOffCooldown();
    const deviceId = config.screensaver?.deviceId;
    if (deviceId) {
      DaylightAPI(`api/v1/device/${deviceId}/screen/suppress-wake`, { minutes }, 'POST').catch(() => {});
    }
    setCurrentUser('guest');
  }, [config.screensaver, turnOffScreen, beginScreenOffCooldown, setCurrentUser]);
}

export default usePianoScreenOff;
