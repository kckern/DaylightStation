// frontend/src/modules/Media/CastTargetChip.jsx
import React, { useMemo } from 'react';
import { useCastTarget } from './useCastTarget.jsx';
import getLogger from '../../lib/logging/Logger.js';

const CastTargetChip = ({ onClick }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastTargetChip' }), []);
  const { device, status, stepLabel, error, retry } = useCastTarget();

  const handleClick = (e) => {
    e.stopPropagation();
    if (status === 'error') {
      logger.info('cast-chip.retry');
      retry();
      return;
    }
    onClick?.();
  };

  // No target set
  if (!device) {
    return (
      <button
        className="cast-target-chip cast-target-chip--empty"
        onClick={handleClick}
        aria-label="Set cast target"
        title="Cast to a device"
      >
        <span className="cast-target-chip__icon">&#x1F4E1;</span>
      </button>
    );
  }

  const stateClass = `cast-target-chip--${status}`;

  return (
    <button
      className={`cast-target-chip ${stateClass}`}
      onClick={handleClick}
      aria-label={status === 'error' ? 'Cast failed — tap to retry' : `Casting to ${device.name}`}
      title={status === 'error' ? 'Tap to retry' : device.name}
    >
      {status === 'idle' && (
        <>
          <span className="cast-target-chip__dot" />
          <span className="cast-target-chip__name">{device.name}</span>
          <span className="cast-target-chip__arrow">&#x25BE;</span>
        </>
      )}
      {status === 'sending' && (
        <>
          <span className="cast-target-chip__pulse">&#x26A1;</span>
          <span className="cast-target-chip__step">{stepLabel}</span>
        </>
      )}
      {status === 'success' && (
        <>
          <span className="cast-target-chip__check">&#x2713;</span>
          <span className="cast-target-chip__name">Playing on {device.name}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <span className="cast-target-chip__warn">&#x26A0;</span>
          <span className="cast-target-chip__error">Failed — tap to retry</span>
        </>
      )}
    </button>
  );
};

export default CastTargetChip;
