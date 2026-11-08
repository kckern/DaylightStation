/**
 * Whether a title's EDL meets what the profile asks for before filtering it.
 * A raw VidAngel EDL has no certification (level none). The profile says what it
 * needs with `requiresCertification` (none | machine | parent); default machine.
 * Household nudges (`cueOverrides.<id>.startMs/endMs`) on a refined EDL are
 * counted: a nudge that uncovers a word drops the level (certification.mjs).
 */
import { certify } from '../../domain/content-filter/refine/certification.mjs';

const LEVELS = ['none', 'machine', 'parent'];
const hasNudges = (cueOverrides) => Object.values(cueOverrides || {})
  .some((ov) => Number.isFinite(ov?.startMs) || Number.isFinite(ov?.endMs));

export function readiness(edl, profile, override = null) {
  const counted = edl?.timebase?.clock === 'vidangel' && hasNudges(override?.cueOverrides)
    ? certify(edl, { at: edl.certification?.machine?.at ?? null, cueOverrides: override.cueOverrides }).level
    : edl?.certification?.level;
  const level = LEVELS.includes(counted) ? counted : 'none';
  const requires = LEVELS.includes(profile?.requiresCertification) ? profile.requiresCertification : 'machine';
  return { level, requires, ready: LEVELS.indexOf(level) >= LEVELS.indexOf(requires) };
}
