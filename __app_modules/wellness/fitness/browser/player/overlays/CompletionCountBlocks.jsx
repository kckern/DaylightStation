import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const normalizeCount = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

const resolveUserLabel = (value, resolver, index) => {
  const resolved = typeof resolver === 'function' ? resolver(value, index) : value;
  if (typeof resolved === 'string') return resolved;
  if (resolved && typeof resolved === 'object') {
    if (typeof resolved.displayName === 'string') return resolved.displayName;
    if (typeof resolved.name === 'string') return resolved.name;
    if (typeof resolved.userId === 'string') return resolved.userId;
    if (typeof resolved.id === 'string') return resolved.id;
    if (typeof resolved.label === 'string') return resolved.label;
  }
  return typeof value === 'string' ? value : '';
};

const getInitial = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed.match(/[A-Za-z0-9]/);
  return first ? first[0].toUpperCase() : '';
};

function CompletionCountBlocks({
  targetCount,
  actualCount,
  metUsers = [],
  holdingUsers = [],
  containerClassName,
  blockClassName,
  completeBlockClassName,
  holdingBlockClassName,
  activeBlockClassName,
  activeIndex,
  ariaLabel,
  resolveMetUserLabel
}) {
  const { normalizedTarget, completedCount, blocks } = useMemo(() => {
    const safeTarget = normalizeCount(targetCount);
    const safeActual = normalizeCount(actualCount);
    if (safeTarget <= 0) {
      return { normalizedTarget: 0, completedCount: 0, blocks: [] };
    }

    const safeCompleted = Math.min(safeTarget, safeActual);
    const safeMetUsers = Array.isArray(metUsers) ? metUsers : [];
    const safeHoldingUsers = Array.isArray(holdingUsers) ? holdingUsers.filter(Boolean) : [];
    const safeActiveIndex = Number.isFinite(activeIndex) ? Math.round(activeIndex) : -1;
    const nextBlocks = Array.from({ length: safeTarget }, (_, index) => {
      const complete = index < safeCompleted;
      // Riders in the zone whose hold has not completed fill the next blocks
      // as "holding" — neither met nor missing.
      const holdingUser = !complete ? safeHoldingUsers[index - safeCompleted] : undefined;
      const holding = holdingUser !== undefined;
      const user = complete ? safeMetUsers[index] : (holding ? holdingUser : null);
      const initial = (complete || holding) ? getInitial(resolveUserLabel(user, resolveMetUserLabel, index)) : '';
      return {
        id: index + 1,
        complete,
        holding,
        active: !complete && !holding && index === safeActiveIndex,
        initial
      };
    });

    return {
      normalizedTarget: safeTarget,
      completedCount: safeCompleted,
      blocks: nextBlocks
    };
  }, [targetCount, actualCount, metUsers, holdingUsers, resolveMetUserLabel, activeIndex]);

  if (!blocks.length) return null;

  return (
    <div
      className={containerClassName}
      role="meter"
      aria-label={ariaLabel || `Completion progress ${completedCount} of ${normalizedTarget}`}
      aria-valuemin={0}
      aria-valuemax={normalizedTarget}
      aria-valuenow={completedCount}
    >
      {blocks.map((block) => {
        const className = [
          blockClassName,
          block.complete ? completeBlockClassName : null,
          block.holding && holdingBlockClassName ? holdingBlockClassName : null,
          block.active && activeBlockClassName ? activeBlockClassName : null
        ].filter(Boolean).join(' ');
        return (
          <span key={block.id} className={className} aria-hidden="true">
            {(block.complete || block.holding) && block.initial ? block.initial : null}
          </span>
        );
      })}
    </div>
  );
}

CompletionCountBlocks.propTypes = {
  targetCount: PropTypes.number,
  actualCount: PropTypes.number,
  metUsers: PropTypes.array,
  holdingUsers: PropTypes.array,
  containerClassName: PropTypes.string.isRequired,
  blockClassName: PropTypes.string.isRequired,
  completeBlockClassName: PropTypes.string.isRequired,
  holdingBlockClassName: PropTypes.string,
  activeBlockClassName: PropTypes.string,
  activeIndex: PropTypes.number,
  ariaLabel: PropTypes.string,
  resolveMetUserLabel: PropTypes.func
};

export default CompletionCountBlocks;
