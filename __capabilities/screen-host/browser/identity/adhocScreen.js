/**
 * Ad-hoc screens: any browser can be a screen (`/screen/adhoc`). Its served config names
 * its device as `$browser`; the page puts this browser's own persistent identity
 * (`browser:<token>`, lib/deviceIdentity.js) in its place, so commands addressed to that
 * id (a phone's D-pad, a remote) reach this page and no other, and the page's presence
 * and acks are reported under it. A configured screen (office-tv) is untouched.
 *
 * The page names itself (`?name=MacBook`, remembered by this browser; "Browser" until
 * named) and announces itself to the household screen registry on mount and every
 * ANNOUNCE_EVERY_MS while open, which is how it appears in lists of screens to connect
 * to while it is open.
 *
 * Pure apart from the storage and timer seams callers pass in.
 */

/** The device placeholder an ad-hoc screen config carries. */
export const BROWSER_DEVICE = '$browser';
export const NAME_KEY = 'ds_screen_name';
export const DEFAULT_NAME = 'Browser';
export const MAX_NAME = 48;
export const ANNOUNCE_EVERY_MS = 60_000;
/** The shape a browser screen id must have to be addressed at all. */
export const BROWSER_SCREEN_ID = /^browser:[A-Za-z0-9_-]{4,64}$/;

/**
 * The config with `$browser` replaced by this browser's id.
 * @returns {{ config: Object, browserScreen: boolean }} browserScreen: the device is this browser
 */
export function resolveScreenDevice(config, browserId) {
  const device = config?.websocket?.guardrails?.device;
  if (device !== BROWSER_DEVICE) return { config, browserScreen: false };
  const id = typeof browserId === 'string' && BROWSER_SCREEN_ID.test(browserId) ? browserId : null;
  // No persistent identity (private mode): the page still renders, but takes no commands.
  const guardrails = { ...config.websocket.guardrails, device: id };
  return {
    config: { ...config, websocket: { ...config.websocket, guardrails, commands: id ? config.websocket.commands : false } },
    browserScreen: Boolean(id),
  };
}

/** The screen's name: `?name=` (then remembered), else the remembered one, else "Browser". */
export function screenName(search, storage) {
  let fromUrl = null;
  try {
    const params = new URLSearchParams((search || '').replace(/^\?/, ''));
    fromUrl = clean(params.get('name'));
  } catch { /* no name */ }
  if (fromUrl) {
    try { storage?.setItem(NAME_KEY, fromUrl); } catch { /* this page still uses it */ }
    return fromUrl;
  }
  let stored = null;
  try { stored = clean(storage?.getItem(NAME_KEY)); } catch { /* none */ }
  return stored || DEFAULT_NAME;
}

function clean(value) {
  if (typeof value !== 'string') return null;
  const v = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return v || null;
}

/**
 * Announce now and every ANNOUNCE_EVERY_MS until stopped. A failed announce is retried
 * at the next tick, never thrown.
 * @returns {() => void} stop
 */
export function startScreenAnnounce({ id, name, post, every = ANNOUNCE_EVERY_MS,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  if (!id || typeof post !== 'function') return () => {};
  const send = () => { Promise.resolve().then(() => post({ id, name })).catch(() => {}); };
  send();
  const timer = setIntervalFn(send, every);
  return () => clearIntervalFn(timer);
}
