const TIERS = Object.freeze({ warm: 2, hot: 3, fire: 4 });

// Consume the same trusted, individualized zone profile as Fitness governance.
// A disconnected strap's last zone must never remain a permanent power-up.
export function weaponPower(profile, now = Date.now()) {
  const at = profile?.zoneReadingAt;
  if (profile?.zoneTrusted !== true || profile?.zoneReadingEligible !== true
    || !Number.isFinite(at) || now < at || now - at > 10000) return 1;
  return TIERS[profile.currentZoneId] || 1;
}
