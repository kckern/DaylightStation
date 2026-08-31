import { DaylightAPI } from '../../../lib/api.mjs';
import { getDeviceId } from '../../../lib/deviceIdentity.js';

const base = deviceId => `/api/v1/admin/household/devices/${encodeURIComponent(deviceId)}/fully-kiosk`;

async function jsonRequest(request) {
  try {
    return await request;
  } catch (error) {
    const jsonSuffix = / - (\{.*\})$/.exec(error?.message || '');
    if (jsonSuffix) {
      try {
        const body = JSON.parse(jsonSuffix[1]);
        if (body?.error) {
          const safeError = new Error(body.error);
          safeError.status = error.status;
          safeError.code = body.code;
          throw safeError;
        }
      } catch (parseError) {
        if (parseError?.code || parseError?.status) throw parseError;
      }
    }
    throw error;
  }
}

export const fullyKioskAdminApi = {
  status: deviceId => jsonRequest(DaylightAPI(`${base(deviceId)}/status`)),
  settings: deviceId => jsonRequest(DaylightAPI(`${base(deviceId)}/settings`)),
  action: (deviceId, action, params = {}) => jsonRequest(DaylightAPI(
    `${base(deviceId)}/actions/${encodeURIComponent(action)}`,
    params,
    'POST',
  )),
  updateSetting: (deviceId, key, value) => jsonRequest(DaylightAPI(
    `${base(deviceId)}/settings/${encodeURIComponent(key)}`,
    { value },
    'PUT',
  )),
  async screenshot(deviceId, { signal } = {}) {
    const token = localStorage.getItem('ds_token');
    const response = await fetch(`${window.location.origin}${base(deviceId)}/screenshot`, {
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Daylight-Device': getDeviceId(),
      },
    });
    if (!response.ok) {
      let message = `Screenshot failed (${response.status})`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch { /* response was not JSON */ }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return {
      blob: await response.blob(),
      capturedAt: response.headers.get('X-Captured-At') || new Date().toISOString(),
    };
  },
};

export default fullyKioskAdminApi;
