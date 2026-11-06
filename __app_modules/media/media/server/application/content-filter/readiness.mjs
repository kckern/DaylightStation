/**
 * Whether a title's EDL meets what the profile asks for before filtering it.
 * A raw VidAngel EDL has no certification (level none). The profile says what it
 * needs with `requiresCertification` (none | machine | parent); default machine.
 */
const LEVELS = ['none', 'machine', 'parent'];

export function readiness(edl, profile) {
  const level = LEVELS.includes(edl?.certification?.level) ? edl.certification.level : 'none';
  const requires = LEVELS.includes(profile?.requiresCertification) ? profile.requiresCertification : 'machine';
  return { level, requires, ready: LEVELS.indexOf(level) >= LEVELS.indexOf(requires) };
}
