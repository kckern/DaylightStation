import { useApiResource } from './useApiResource.js';

const EMPTY_DEVICES = Object.freeze({});

export function useDeviceConfig(options) {
  const resource = useApiResource('api/v1/device/config', options);
  const devices = resource.data?.devices ?? resource.data;
  return {
    ...resource,
    devices: devices && typeof devices === 'object' && !Array.isArray(devices) ? devices : EMPTY_DEVICES,
  };
}
