/**
 * Power-cycle the piano through its HA smart plug: off, wait, on.
 *
 * The piano powers itself back on when plug power returns (verified 2026-08-25:
 * 14.9 W three seconds after turn_on), so this is a full unattended reboot of the
 * piano and its built-in Bluetooth speaker. Once turn_off has landed, turn_on is ALWAYS
 * attempted and retried; a failure there is reported as `unpowered` so the
 * supervisor can page someone at once instead of leaving the piano dark.
 */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** HomeAssistantAdapter.callService resolves {ok:false, error} instead of throwing; treat both as failure. */
async function call(haGateway, service, data) {
  const res = await haGateway.callService('switch', service, data);
  if (res && res.ok === false) throw new Error(res.error || 'refused');
  return res;
}

export function createHaPlugCycle({ haGateway, entityId, sleep = realSleep, retries = 3, retryDelayMs = 2000 } = {}) {
  if (typeof haGateway?.callService !== 'function') throw new Error('createHaPlugCycle requires haGateway');
  if (!entityId) throw new Error('createHaPlugCycle requires entityId');
  const data = { entity_id: entityId };
  return async function plugCycle(offMs) {
    try {
      await call(haGateway, 'turn_off', data);
    } catch (err) {
      return { ok: false, unpowered: false, error: `turn_off: ${String(err?.message ?? err)}` };
    }
    await sleep(offMs);
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await call(haGateway, 'turn_on', data);
        return { ok: true, error: null, unpowered: false };
      } catch (err) {
        lastError = err;
        if (attempt < retries) await sleep(retryDelayMs);
      }
    }
    return { ok: false, unpowered: true, error: `turn_on: ${String(lastError?.message ?? lastError)}` };
  };
}

export default createHaPlugCycle;
