import { inDaylightShell } from '../../../../../frontend/src/lib/daylightKiosk.js';

export { inDaylightShell };

export async function pianoToolResponse(method, args, legacy) {
  if (!inDaylightShell()) return legacy();
  const page = window.daylight?.deviceId === 'piano' ? window.daylight.piano : null;
  const body = await page?.[method]?.(...args);
  if (!body) throw new Error('Piano page tool unavailable');
  return { ok: body.ok === true, status: body.ok === true ? 200 : 409, json: async () => body };
}
