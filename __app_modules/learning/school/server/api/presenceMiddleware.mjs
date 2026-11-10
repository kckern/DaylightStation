/**
 * Presence middleware for the school API: human use of the study-room Portal
 * tells Home Assistant someone is in the room.
 *
 * NEVER ON THE CRITICAL PATH. `next()` runs first; the hook fires afterwards,
 * detached, and its failure (sync or async) is swallowed. It cannot delay or
 * alter a response.
 *
 * Fires only for a POST (GETs are board refreshes, polls, posters), from a
 * device named in `presence_hook.devices` (read per request, so edits to
 * school.yml apply without a restart), and not for a grown-up's test sitting
 * (`mode: 'test'`).
 */
export const DEVICE_HEADER = 'x-daylight-device';

// The shared frontend client names fleet screens `fleet:<name>`; the school
// client sends the bare name. Both mean the same device.
const bareDevice = (raw) => String(raw).trim().replace(/^fleet:/, '');

// POSTs the Portal sends WITHOUT a person acting. Presence must mean a person.
const IGNORED_PREFIXES = [
  '/card-ladder/test/', // a grown-up's test sitting (the /test door is a path; its bodies carry no `mode`)
  '/reading/',          // reading-session acks/ends are fired by the screen itself
];
const IGNORED_SUFFIXES = [
  '/heartbeat',         // flashcard 30s timer, no human action (the media-lesson playhead, /lesson/:id/position, is deliberately counted: someone is watching)
];
// Deliberately NOT ignored: remote-launch `POST /sessions` - a grown-up sending
// work to the school room implies a child is about to be there.
const isSelfDriven = (path = '') =>
  IGNORED_PREFIXES.some((p) => path.startsWith(p)) || IGNORED_SUFFIXES.some((x) => path.endsWith(x));

export function createPresenceMiddleware({ presenceHook, loadConfig, logger = null } = {}) {
  return function presenceMiddleware(req, res, next) {
    next();
    try {
      if (!presenceHook || req.method !== 'POST' || isSelfDriven(req.path)) return;
      const raw = req.get?.(DEVICE_HEADER) ?? req.headers?.[DEVICE_HEADER] ?? req.body?.deviceId;
      if (!raw) return;
      const device = bareDevice(raw);
      const devices = loadConfig?.()?.presence_hook?.devices;
      if (!Array.isArray(devices) || !devices.includes(device)) return;
      if (req.body?.mode === 'test') return;
      const outcome = { result: 'present', source: 'portal', device, event: req.path };
      Promise.resolve()
        .then(() => presenceHook.fire(outcome))
        .catch((err) => logger?.debug?.('school.presence.middleware-fire-failed', { error: err?.message }));
    } catch (err) {
      logger?.debug?.('school.presence.middleware-failed', { error: err?.message });
    }
  };
}

export default createPresenceMiddleware;
