/**
 * A fake Home Assistant caller for the acceptance server.
 *
 * Home Assistant starts playback with a plain `GET /api/v1/device/<id>/load?...`
 * and a `HomeAssistant/<version>` User-Agent. Sending exactly that through the
 * fixture's ordinary route runs the REAL path end to end: the request context,
 * RoutineLoadRecorder (origin classification), the routine catalog match, the
 * 10-second trigger dedupe and the routine history write. Nothing here
 * reaches Home Assistant or a household screen.
 *
 * Use from a journey (HTTP to the acceptance server) or from a unit test
 * (HTTP to `app.listen(0)` of the device fixture).
 */
export const HA_USER_AGENT = 'HomeAssistant/2026.9.4 aiohttp/3.10.5 Python/3.12';

/** The routine the fixture's routine store holds, and the load it triggers. */
export const HA_FIXTURE_ROUTINE = Object.freeze({
  id: 'automation:acceptance_button',
  name: 'Acceptance button: Morning',
  deviceId: 'acceptance-media',
  query: Object.freeze({ queue: 'morning-program' }),
});

/**
 * @param {Object} options
 * @param {string} options.baseUrl - the acceptance server origin
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.userAgent]
 */
export function createHomeAssistantCaller({ baseUrl, fetchImpl = globalThis.fetch, userAgent = HA_USER_AGENT }) {
  if (!baseUrl) throw new TypeError('createHomeAssistantCaller requires baseUrl');
  const origin = String(baseUrl).replace(/\/$/, '');
  async function load(deviceId, query = {}, { headers = {} } = {}) {
    const url = `${origin}/api/v1/device/${encodeURIComponent(deviceId)}/load?${new URLSearchParams(query)}`;
    const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json', ...headers } });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, ok: response.ok, body };
  }
  /**
   * A routine that drives a BROWSER device (a tab left open on a wall tablet).
   * A browser is not reached by an HTTP load: it listens on its own
   * `client-control:<stable id>` bus topic, so a routine addresses it by that
   * stable id (never by its name) over the same socket every client uses, with
   * `origin: {kind: 'routine'}`. Returns the browser's own acknowledgement.
   */
  async function loadBrowser(clientId, { play, routine, triggerId = `${routine ?? 'routine'}-${Date.now()}`, timeoutMs = 15000 } = {}) {
    if (!clientId || !play) throw new TypeError('loadBrowser requires clientId and play');
    const { default: WebSocket } = await import('ws');
    const callerId = `routine-caller-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const commandId = `${callerId}-cmd`;
    const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws`, { headers: { 'User-Agent': userAgent } });
    const inbox = [];
    const waiters = [];
    socket.on('message', (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      const index = waiters.findIndex((w) => w.predicate(message));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else inbox.push(message);
    });
    const waitFor = (predicate) => new Promise((resolve, reject) => {
      const queued = inbox.findIndex(predicate);
      if (queued >= 0) { resolve(inbox.splice(queued, 1)[0]); return; }
      const timer = setTimeout(() => reject(new Error('routine-to-browser-timeout')), timeoutMs);
      waiters.push({ predicate, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
    try {
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      const nonce = `${commandId}-identify`;
      socket.send(JSON.stringify({ type: 'identify', clientId: callerId, nonce }));
      await waitFor((m) => m.type === 'identify_ack' && m.nonce === nonce && m.ok === true);
      socket.send(JSON.stringify({
        topic: `client-control:${clientId}`, commandId, command: 'queue',
        params: { op: 'play-now', contentId: play },
        origin: { kind: 'routine', ...(routine ? { name: routine } : {}), triggerId },
      }));
      return await waitFor((m) => m.topic === `client-ack:${callerId}` && m.commandId === commandId);
    } finally {
      socket.close();
    }
  }

  return {
    userAgent,
    load,
    loadBrowser,
    /** Fire the seeded routine (button press): load the routine's own query on its screen. */
    fireRoutine: (routine = HA_FIXTURE_ROUTINE) => load(routine.deviceId, routine.query),
    /** The routine history the server recorded (same data the House view shows). */
    history: async ({ limit = 50 } = {}) => {
      const response = await fetchImpl(`${origin}/api/v1/media/routines/history?limit=${limit}`);
      return (await response.json()).items ?? [];
    },
  };
}
