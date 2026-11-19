import { pianoToolResponse } from './pianoPageTools.js';

// bridgeAudioVolume — ask the native bridge whether the tablet's OS media volume is
// actually up (POST http://localhost:8770/audio-guard/volume-check).
//
// The kiosk's Media Volume is a software level on the media element. It multiplies
// against Android's STREAM_MUSIC index for the A2DP speaker, so "max" over an OS
// index of 0/15 is silence while every status surface reads "connected"
// (2026-10-28, 2026-11-13). The bridge's audio guard raises that index when A2DP is
// the settled route; this call makes every volume press verify it.
//
// Off the tablet (dev browser, preview) there is no bridge: resolves { available: false }.

const URL = 'http://localhost:8770/audio-guard/volume-check';

/**
 * @returns {Promise<{available:boolean, routeOk?:boolean, musicIndex?:number,
 *   musicMax?:number, raised?:boolean, silent?:boolean}>}
 *   `silent` is true when A2DP is the route and its OS index is still below max
 *   after the check — the one state the UI must surface.
 */
export async function checkBridgeMediaVolume({ fetchImpl = (...a) => fetch(...a), timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await pianoToolResponse('checkVolume', [], () => fetchImpl(URL, { method: 'POST', cache: 'no-store', signal: controller.signal }));
    const body = await res.json();
    const g = body?.guard;
    if (!res.ok || body?.ok !== true || !g) return { available: false, error: body?.error || `http_${res.status}` };
    const musicIndex = Number(g.musicIndex);
    const musicMax = Number(g.musicMax);
    const routeOk = g.routeOk === true;
    return {
      available: true,
      routeOk,
      musicIndex,
      musicMax,
      raised: g.raised === true,
      silent: routeOk && musicMax > 0 && musicIndex >= 0 && musicIndex < musicMax,
    };
  } catch (error) {
    return { available: false, error: error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
