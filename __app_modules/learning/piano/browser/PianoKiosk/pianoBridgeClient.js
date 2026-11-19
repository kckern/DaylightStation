import { pagePiano } from './bridgeMidiOut.js';

const RESET_URL = 'http://localhost:8770/reset';

function verifiedResult(body) {
  if (body?.fixed !== true) return { ok: false, reason: body?.reason || 'not-fixed', verdict: body?.verdict ?? null };
  return { ok: true, reason: 'fixed', recoveredAt: body.recoveredAt ?? null, verdict: body.verdict ?? body.linkVerdict ?? null };
}

async function resetPagePiano(piano, timeoutMs) {
  if (!piano.startRepair()) return { ok: false, reason: 'unavailable' };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = piano.repairResult();
    if (!result?.pending) return verifiedResult(result);
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
  return { ok: false, reason: 'timeout' };
}

/** Reset and verify the native piano bridge without leaking fetch details to UI. */
export async function resetPianoBridge({ fetchImpl = fetch, timeoutMs = 65000 } = {}) {
  const piano = pagePiano();
  if (piano) return resetPagePiano(piano, timeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RESET_URL, { method: 'POST', signal: controller.signal });
    if (!response.ok) return { ok: false, reason: 'http-error', status: response.status };
    let body;
    try { body = await response.json(); } catch { return { ok: false, reason: 'invalid-response' }; }
    if (body?.fixed !== true) return { ok: false, reason: 'not-fixed', verdict: body?.verdict ?? null };
    return { ok: true, reason: 'fixed', recoveredAt: body?.recoveredAt ?? null, verdict: body?.verdict ?? null };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'unreachable', error: error?.message || 'request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export default resetPianoBridge;
