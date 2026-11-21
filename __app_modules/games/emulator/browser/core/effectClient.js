/**
 * effectClient — asks the backend to run a household effect from the registry.
 *
 * The browser only names the effect and the phase; what the effect does (Home
 * Assistant scenes, lights, scripts) is read from media/emulation/effects.yml on
 * the server, so a page can never make an arbitrary Home Assistant call.
 *
 * `keepalive` lets the exit request outlive the page when the game is closed by
 * navigating away. Never throws: a failed effect must not disturb gameplay.
 */

const BASE = '/api/v1/emulator/effects';
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl]
 * @param {object} [opts.logger]
 * @returns {(effectId:string, phase:'enter'|'exit', context?:object) => Promise<object|null>}
 */
export function createEffectClient({ fetchImpl = (...a) => globalThis.fetch(...a), logger } = {}) {
  return async function runEffect(effectId, phase, context = {}) {
    if (!ID.test(String(effectId)) || (phase !== 'enter' && phase !== 'exit')) {
      logger?.warn?.('emulator.effect.request-invalid', { effectId, phase });
      return null;
    }
    const body = { phase, game: context.game ?? null, reason: context.reason ?? null };
    try {
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(effectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        logger?.warn?.('emulator.effect.request-failed', { effectId, phase, status: res.status, error: json?.error });
        return null;
      }
      logger?.debug?.('emulator.effect.request-ok', { effectId, phase, result: json?.status });
      return json;
    } catch (err) {
      logger?.warn?.('emulator.effect.request-error', { effectId, phase, error: err?.message });
      return null;
    }
  };
}

export default createEffectClient;
