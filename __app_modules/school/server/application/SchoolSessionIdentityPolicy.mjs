import { shortIdLower } from '#system/utils/id.mjs';

/** Mints the canonical lowercase school work-session identity. */
export function createSchoolSessionId(newShortId = () => shortIdLower(10)) {
  const suffix = newShortId();
  if (!/^[a-z0-9]{10}$/.test(suffix)) {
    throw new Error('School session identity source must return ten lowercase alphanumeric characters');
  }
  return `ses_${suffix}`;
}
