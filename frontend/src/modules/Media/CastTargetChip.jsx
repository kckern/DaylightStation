// frontend/src/modules/Media/CastTargetChip.jsx
import React, { useMemo, useCallback } from 'react';
import { useCastTarget } from './useCastTarget.jsx';
import getLogger from '../../lib/logging/Logger.js';

const VOLUME_STEP = 5;

const CastTargetChip = ({ onClick }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastTargetChip' }), []);
  const { device, settings, status, stepLabel, retry, setDeviceVolume } = useCastTarget();

  const handleClick = (e) => {
    e.stopPropagation();
    if (status === 'error') {
      logger.info('cast-chip.retry');
      retry();
      return;
    }
    onClick?.();
  };

  const handleVolDown = useCallback((e) => {
    e.stopPropagation();
    const current = settings.volume ?? 50;
    setDeviceVolume(current - VOLUME_STEP);
  }, [settings.volume, setDeviceVolume]);

  const handleVolUp = useCallback((e) => {
    e.stopPropagation();
    const current = settings.volume ?? 50;
    setDeviceVolume(current + VOLUME_STEP);
  }, [settings.volume, setDeviceVolume]);

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
  const showVolume = status === 'idle' || status === 'success';

  return (
    <div className={`cast-target-chip ${stateClass}`}>
      <button className="cast-target-chip__main" onClick={handleClick}>
        {status === 'idle' && (
          <>
            <span className="cast-target-chip__dot" />
            <span className="cast-target-chip__name">{device.name || device.id}</span>
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
            <span className="cast-target-chip__name">Playing on {device.name || device.id}</span>
          </>
        )}
        {status === 'error' && (
          <>
            <span className="cast-target-chip__warn">&#x26A0;</span>
            <span className="cast-target-chip__error">Failed — tap to retry</span>
          </>
        )}
      </button>
      {showVolume && (
        <span className="cast-target-chip__volume">
          <button className="cast-target-chip__vol-btn" onClick={handleVolDown} aria-label="Volume down">−</button>
          <span className="cast-target-chip__vol-level">{settings.volume ?? '—'}</span>
          <button className="cast-target-chip__vol-btn" onClick={handleVolUp} aria-label="Volume up">+</button>
        </span>
      )}
    </div>
  );
};

export default CastTargetChip;
