import { DaylightMediaPath } from '@/lib/api.mjs';

export const EQUIPMENT_FALLBACK = DaylightMediaPath('/static/img/equipment/equipment');

export const AVATAR_BASE = '/api/v1/static/img/users';
export const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;

// Named tiers so riders pick a *category* (effort/length) rather than anchoring
// on the raw number. The value is shown as a sub-label; the custom stepper still
// lets you dial in anything. Medium is the default-selected tier.
export const DISTANCE_TIERS = [
  { key: 'flash', label: 'Flash', value: 100 },
  { key: 'sprint', label: 'Sprint', value: 300 },
  { key: 'short', label: 'Short', value: 1000 },
  { key: 'medium', label: 'Medium', value: 2500 },
  { key: 'long', label: 'Long', value: 5000 }
];
export const TIME_TIERS = [
  { key: 'flash', label: 'Flash', value: 60 },
  { key: 'sprint', label: 'Sprint', value: 120 },
  { key: 'short', label: 'Short', value: 180 },
  { key: 'medium', label: 'Medium', value: 300 },
  { key: 'long', label: 'Long', value: 600 }
];
export const DEFAULT_TIER_KEY = 'medium';

export const DISTANCE_STEP_M = 500;
export const TIME_STEP_S = 60;
