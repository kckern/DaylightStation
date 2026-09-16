/**
 * Map a "crossed into the Fire zone" event to a FitnessToast payload. Pure —
 * the fireball URL is injected by the caller (FitnessContext resolves it through
 * DaylightMediaPath, exactly as the ring celebration resolves its icon).
 *
 * This toast is deliberately FRAMELESS: no card, no border, no shadow. It is the
 * one moment that belongs to a single person mid-workout, and it reads as the
 * room noticing them rather than as the system posting a notice.
 *
 * @param {Object} event - { userId, name }
 * @param {Object} [opts]
 * @param {string} [opts.fireballUrl] - resolved URL for the fireball backdrop
 * @returns {Object} toast payload for FitnessToast
 */

/** Matches the ring celebration — this is a celebration, not a notice. */
export const FIRE_TOAST_DURATION_MS = 3500;

export function buildFireToast({ userId, name } = {}, { fireballUrl } = {}) {
  return {
    kind: 'fire',
    variant: 'fire',
    // Suppresses the card chrome in FitnessToast.scss.
    frameless: true,
    durationMs: FIRE_TOAST_DURATION_MS,
    name: name || userId,
    avatarUrl: `/api/v1/static/img/users/${userId}`,
    fireballUrl: fireballUrl || null,
  };
}

export default buildFireToast;
