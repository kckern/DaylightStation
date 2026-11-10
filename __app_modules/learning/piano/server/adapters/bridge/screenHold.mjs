/**
 * Pin the piano tablet's screen to whatever it shows NOW, for a while.
 *
 * The speaker ladder's plug rungs cut the piano's power for up to 30 s. The power
 * sync authority (PianoScreenAuthorityService) reads that as "piano off" — it blanks
 * the screen after its off-debounce and pulses it on at the power edge. A live
 * ScreenOverrideService entry makes it stand down, so the hold copies the current
 * state rather than forcing one: a lit screen stays lit, a dark room stays dark.
 * A person's own override is never replaced.
 *
 * @returns {(ms:number) => Promise<'on'|'off'|null>} the state pinned, or null if none
 */
export function createScreenHold({ deviceService, overrides, deviceId } = {}) {
  if (typeof deviceService?.get !== 'function') throw new Error('createScreenHold requires deviceService');
  if (typeof overrides?.set !== 'function') throw new Error('createScreenHold requires overrides');
  if (!deviceId) throw new Error('createScreenHold requires deviceId');
  return async function holdScreen(ms) {
    if (overrides.get(deviceId)) return null;
    const status = await deviceService.get(deviceId)?.getStatus?.();
    if (typeof status?.screenOn !== 'boolean') return null;
    const state = status.screenOn ? 'on' : 'off';
    overrides.set(deviceId, state, ms / 60_000);
    return state;
  };
}

export default createScreenHold;
