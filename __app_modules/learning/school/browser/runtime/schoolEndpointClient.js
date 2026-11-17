import { createSchoolTransport } from './schoolTransport.js';
import { schoolApi } from '../schoolApi.js';
import { schoolDeviceHeaders } from '../schoolDevice.js';

/** Feature facades use an explicit immutable scope. Omitted scope keeps standalone browser compatibility. */
export function createSchoolEndpointClient({ base, deviceId, transport: suppliedTransport, ...options }) {
  const legacy = deviceId === undefined && !suppliedTransport;
  const transport = suppliedTransport ?? (legacy && !Object.keys(options).length ? (schoolApi.transport ?? createSchoolTransport()) : createSchoolTransport({ ...options, deviceId }));
  return {
    transport,
    request(path, { headers = {}, ...requestOptions } = {}) {
      return transport.request(`${base}${path}`, { ...requestOptions, headers: legacy ? schoolDeviceHeaders(headers) : headers });
    },
    finish: result => legacy ? { ok: result.ok, status: result.status, data: result.data } : result,
  };
}
