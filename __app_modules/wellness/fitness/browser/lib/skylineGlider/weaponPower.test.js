import { it, expect } from 'vitest';
import { weaponPower } from './weaponPower.js';
it('uses only fresh eligible trusted individualized HR zones', () => {
  const now = 100000;
  const reading = { zoneTrusted: true, zoneReadingEligible: true, zoneReadingAt: now, currentZoneId: 'warm' };
  for (const [zone, power] of [['cool', 1], ['active', 1], ['warm', 2], ['hot', 3], ['fire', 4]]) expect(weaponPower({ ...reading, currentZoneId: zone }, now)).toBe(power);
  for (const invalid of [null, {}, { ...reading, zoneTrusted: false }, { ...reading, zoneReadingEligible: false }, { ...reading, zoneReadingAt: now - 30000 }, { ...reading, zoneReadingAt: now + 1000 }]) expect(weaponPower(invalid, now)).toBe(1);
});
