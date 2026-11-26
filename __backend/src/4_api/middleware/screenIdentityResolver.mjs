// __backend/src/4_api/middleware/screenIdentityResolver.mjs

/**
 * Screens never sign in. A screen is identified by the device id it already sends
 * (`X-Daylight-Device: fleet:<name>`, see deviceResolver), and only when that name is
 * declared in the household's devices.yml and the request arrives over the house network.
 *
 * Sets `req.screen = { id }` and nothing else: it is NOT a sign-in. `req.user` stays
 * unset, so every route that requires a signed-in person (admin, migration, editing)
 * still refuses a screen. Only routes that opt in through `screenOrUserViewerFor`
 * (showing an agenda, starting its activities) accept it.
 *
 * Fails closed: an unreadable device registry identifies no screen.
 */
export function screenIdentityResolver({ isDeclaredScreen, logger = null, observe = null, clock = Date.now }) {
  if (typeof isDeclaredScreen !== 'function') throw new Error('isDeclaredScreen is required');
  const announced = new Set();
  let currentHour;
  return (req, _res, next) => {
    if (req.user || !req.isLocal || req.deviceIdSource !== 'header') return next();
    const deviceId = req.deviceId;
    if (typeof deviceId !== 'string' || !deviceId.startsWith('fleet:')) return next();
    const id = deviceId.slice('fleet:'.length);
    let declared = false;
    try { declared = isDeclaredScreen(id, req.householdId) === true; }
    catch (error) { logger?.warn?.('auth.screen.registry_unreadable', { error: error.message }); }
    if (!declared) return next();
    req.screen = { id };
    const lastSeen = clock();
    const hour = Math.floor(lastSeen / 3_600_000);
    if (hour !== currentHour) {
      announced.clear();
      currentHour = hour;
    }
    const key = JSON.stringify([req.householdId, id]);
    if (!announced.has(key)) {
      announced.add(key);
      logger?.info?.('auth.screen.identified', { screen: id, householdId: req.householdId });
      observe?.({ householdId: req.householdId, id, lastSeen });
    }
    next();
  };
}

export default screenIdentityResolver;
