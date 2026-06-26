// Pure zone resolver for the fullscreen vitals overlay. Extracted from
// FullscreenVitalsOverlay.jsx so it is unit-testable, and fixed so a device
// with a live heart rate resolves a zone even when it is NOT mapped to a
// configured user. A heart-rate zone is a function of BPM, not identity — an
// anonymous strap broadcasting 130 bpm is clearly "warm".
export const canonicalZones = ['cool', 'active', 'warm', 'hot', 'fire'];

export const resolveUserZone = (userName, device, context) => {
  const { userCurrentZones, zones = [], usersConfigRaw } = context || {};
  const entry = userName ? userCurrentZones?.[userName] : null;
  let zoneId = null;
  let color = null;

  if (entry) {
    if (typeof entry === 'object') {
      zoneId = entry.id || null;
      color = entry.color || null;
    } else if (typeof entry === 'string') {
      color = entry;
    }
  }

  if (color && !zoneId) {
    const normalizedColor = String(color).toLowerCase();
    zoneId = zones.find((z) => String(z.color).toLowerCase() === normalizedColor)?.id || normalizedColor;
  }

  // HR-based fallback — works with OR without a resolved user. When userName is
  // null, cfg is null → overrides is {} → canonical z.min thresholds apply.
  if ((!zoneId || !canonicalZones.includes(zoneId)) && device?.heartRate) {
    const cfg = userName
      ? (usersConfigRaw?.primary?.find((u) => u.name === userName)
        || usersConfigRaw?.secondary?.find((u) => u.name === userName))
      : null;
    const overrides = cfg?.zones || {};
    const sorted = [...zones].sort((a, b) => b.min - a.min);
    for (const z of sorted) {
      const min = typeof overrides[z.id] === 'number' ? overrides[z.id] : z.min;
      if (device.heartRate >= min) {
        zoneId = z.id;
        color = z.color;
        break;
      }
    }
  }

  return {
    id: zoneId && canonicalZones.includes(zoneId) ? zoneId : null,
    color: color || null
  };
};
