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
  containerClassName,
  blockClassName,
  completeBlockClassName,
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
    const nextBlocks = Array.from({ length: safeTarget }, (_, index) => {
      const complete = index < safeCompleted;
      const user = complete ? safeMetUsers[index] : null;
      const initial = complete ? getInitial(resolveUserLabel(user, resolveMetUserLabel, index)) : '';
      return {
        id: index + 1,
        complete,
        initial
      };
    });

    return {
      normalizedTarget: safeTarget,
      completedCount: safeCompleted,
      blocks: nextBlocks
    };
  }, [targetCount, actualCount, metUsers, resolveMetUserLabel]);

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
        const className = block.complete
          ? `${blockClassName} ${completeBlockClassName}`
          : blockClassName;
        return (
          <span key={block.id} className={className} aria-hidden="true">
            {block.complete && block.initial ? block.initial : null}
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
  containerClassName: PropTypes.string.isRequired,
  blockClassName: PropTypes.string.isRequired,
  completeBlockClassName: PropTypes.string.isRequired,
  ariaLabel: PropTypes.string,
  resolveMetUserLabel: PropTypes.func
};

export default CompletionCountBlocks;
