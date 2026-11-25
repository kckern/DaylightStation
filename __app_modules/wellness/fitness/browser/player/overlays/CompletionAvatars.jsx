import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';

const FALLBACK_AVATAR = DaylightMediaPath('/static/img/users/user');
const DEFAULT_RING = 'rgba(34, 197, 94, 0.9)';

const normalizeCount = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/**
 * Completion meter for the governance lock header: one slot per required
 * participant, filled left-to-right with the face of whoever earned it.
 *
 * This is the lock screen's credit line. `display.rows` only ever holds
 * participants who are still missing their target, so a rider who reaches
 * their zone drops out of the table entirely — these slots are the only place
 * their contribution stays visible while everyone else catches up.
 *
 * Unfilled slots render as open rings so the remaining work reads at a glance
 * from across the room without parsing the count text.
 */
function CompletionAvatars({
  targetCount,
  actualCount,
  metRows = [],
  containerClassName = 'governance-lock__credits',
  ariaLabel
}) {
  const { slots, target, filled } = useMemo(() => {
    const safeTarget = normalizeCount(targetCount);
    if (safeTarget <= 0) return { slots: [], target: 0, filled: 0 };

    const safeRows = Array.isArray(metRows) ? metRows.filter(Boolean) : [];
    // actualCount is governance's authority on how many have satisfied.
    // metRows can lag it by one when a participant is missing from the display
    // map, so the slot stays filled but anonymous rather than reading as open.
    const safeFilled = Math.min(safeTarget, normalizeCount(actualCount));

    const nextSlots = Array.from({ length: safeTarget }, (_, index) => {
      if (index >= safeFilled) return { key: `open-${index}`, filled: false, rider: null };
      const rider = safeRows[index] || null;
      return { key: rider?.key || `met-${index}`, filled: true, rider };
    });

    return { slots: nextSlots, target: safeTarget, filled: safeFilled };
  }, [targetCount, actualCount, metRows]);

  if (!slots.length) return null;

  const namedRiders = slots
    .map((slot) => slot.rider?.displayName)
    .filter(Boolean);
  const resolvedAriaLabel = ariaLabel
    || (namedRiders.length > 0
      ? `${filled} of ${target} met — ${namedRiders.join(', ')}`
      : `${filled} of ${target} met`);

  return (
    <div
      className={containerClassName}
      role="meter"
      aria-label={resolvedAriaLabel}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={filled}
    >
      {slots.map((slot) => {
        if (!slot.filled) {
          return (
            <span
              key={slot.key}
              className="governance-lock__credit governance-lock__credit--open"
              aria-hidden="true"
            />
          );
        }
        // Governance counted this slot as met but the display map had no entry
        // for the rider. Keep it filled with the generic avatar — reverting it
        // to an open ring would take the credit back.
        const ringColor = slot.rider?.currentZone?.color || DEFAULT_RING;
        return (
          <span
            key={slot.key}
            className="governance-lock__credit governance-lock__credit--met"
            style={{ '--credit-ring': ringColor }}
            title={slot.rider?.displayName || undefined}
            aria-hidden="true"
          >
            <img
              src={slot.rider?.avatarSrc || FALLBACK_AVATAR}
              alt=""
              onError={(event) => {
                const img = event.currentTarget;
                if (img.dataset.fallback) return;
                img.dataset.fallback = '1';
                img.src = FALLBACK_AVATAR;
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

CompletionAvatars.propTypes = {
  targetCount: PropTypes.number,
  actualCount: PropTypes.number,
  metRows: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string,
    displayName: PropTypes.string,
    avatarSrc: PropTypes.string,
    currentZone: PropTypes.object
  })),
  containerClassName: PropTypes.string,
  ariaLabel: PropTypes.string
};

export default CompletionAvatars;
