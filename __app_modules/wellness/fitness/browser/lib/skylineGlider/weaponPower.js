const TIERS = Object.freeze({ warm: 2, hot: 3, fire: 4 });

// The zone a game may act on: the same trusted, individualized profile as
// Fitness governance, at most ten seconds old. Null when it cannot be trusted.
export function trustedZoneId(profile, now = Date.now()) {
  const at = profile?.zoneReadingAt;
  if (profile?.zoneTrusted !== true || profile?.zoneReadingEligible !== true
    || !Number.isFinite(at) || now < at || now - at > 10000) return null;
  return profile.currentZoneId || null;
}

/** Power for a zone id: 1 cool/active/unknown, 2 warm, 3 hot, 4 fire. */
export const zonePower = (zoneId) => TIERS[zoneId] || 1;

// A disconnected strap's last zone must never remain a permanent power-up.
export function weaponPower(profile, now = Date.now()) {
  return zonePower(trustedZoneId(profile, now));
}
