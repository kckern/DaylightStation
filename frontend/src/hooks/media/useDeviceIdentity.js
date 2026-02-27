// frontend/src/hooks/media/useDeviceIdentity.js
import { useMemo } from 'react';

/**
 * Reads `deviceId` from URL query params (injected by WakeAndLoadService
 * when loading content onto kiosk devices like Shield TV).
 * For browser MediaApp clients, deviceId is null and isKiosk is false.
 *
 * @returns {{ deviceId: string|null, isKiosk: boolean }}
 */
export function useDeviceIdentity() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get('deviceId') || null;
    return { deviceId, isKiosk: deviceId !== null };
  }, []);
}

export default useDeviceIdentity;
