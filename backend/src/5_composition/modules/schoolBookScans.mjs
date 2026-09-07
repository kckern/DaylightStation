/** A configured device and its configured School screen are separate identities. */
export function resolveBookScanTarget({ configService, householdId, getScreenConfig }) {
  const selected = configService.getHouseholdAppConfig(householdId, 'school')?.bookScan?.targetDeviceId;
  const devices = configService.getHouseholdDevices(householdId)?.devices ?? {};
  const candidates = Object.entries(devices).flatMap(([deviceId, device]) => {
    if (selected && deviceId !== selected) return [];
    const screenId = /^\/screens?\/([a-zA-Z0-9_-]+)\/?$/.exec(device.screen_path ?? '')?.[1];
    if (!screenId) return [];
    const config = getScreenConfig(screenId);
    const hasSchool = node => node?.widget === 'school' || (node?.children ?? []).some(hasSchool);
    return hasSchool(config?.layout) ? [{ deviceId, screenId, ...(device.content_control && !device.device_control ? { prepareOnly: true } : {}) }] : [];
  });
  return candidates.length === 1 ? candidates[0] : null;
}
