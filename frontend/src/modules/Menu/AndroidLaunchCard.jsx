// frontend/src/modules/Menu/AndroidLaunchCard.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { isFKBAvailable, launchApp, onResume } from '../../lib/fkb.js';
import { DaylightMediaPath } from '../../lib/api.mjs';
import './AndroidLaunchCard.scss';

const VERIFY_DELAY_MS = 2500;
const MAX_RETRIES = 2;

const AndroidLaunchCard = ({ android, title, image, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'AndroidLaunchCard' }), []);
  const [status, setStatus] = useState('checking'); // checking | launching | success | failed | unavailable
  const [retryCount, setRetryCount] = useState(0);
  const verifyTimerRef = useRef(null);

  const attemptLaunch = useCallback(() => {
    if (!android?.package) {
      setStatus('unavailable');
      return;
    }

    if (!isFKBAvailable()) {
      logger.info('android-launch.fkb-unavailable', { package: android.package });
      setStatus('unavailable');
      return;
    }

    setStatus('launching');
    const launched = launchApp(android.package);

    if (!launched) {
      logger.error('android-launch.launchApp-returned-false', { package: android.package });
      setStatus('failed');
      return;
    }

    // If the app launches successfully, FKB goes to background and JS execution
    // suspends. This timer only fires if we're still in the foreground — meaning
    // the app didn't launch. That's our verification signal.
    verifyTimerRef.current = setTimeout(() => {
      logger.warn('android-launch.still-foreground', {
        package: android.package,
        retryCount,
        verdict: 'app did not launch — FKB still in foreground',
      });
      setStatus('failed');
    }, VERIFY_DELAY_MS);
  }, [android, logger, retryCount]);

  // Launch on mount and on retry
  useEffect(() => {
    attemptLaunch();
    return () => { clearTimeout(verifyTimerRef.current); };
  }, [attemptLaunch]);

  // If FKB fires onResume, the user came back from the launched app — dismiss
  useEffect(() => {
    if (status !== 'launching') return;
    onResume(() => {
      clearTimeout(verifyTimerRef.current);
      logger.info('android-launch.confirmed-via-resume', { package: android?.package });
      onClose?.();
    });
  }, [status, android, logger, onClose]);

  const handleRetry = useCallback(() => {
    logger.info('android-launch.retry', { package: android?.package, retryCount: retryCount + 1 });
    setRetryCount(c => c + 1);
  }, [android, logger, retryCount]);

  // Escape/Back always dismisses; Enter retries on failure
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isBack = e.key === 'Escape' || e.key === 'GamepadSelect';
      const isSelect = e.key === 'Enter' || e.key === 'GamepadA';

      if (isBack) {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (status === 'failed' && isSelect) {
        e.preventDefault();
        if (retryCount < MAX_RETRIES) handleRetry();
        else onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, status, retryCount, handleRetry]);

  const imgSrc = image && (image.startsWith('/media/') || image.startsWith('media/'))
    ? DaylightMediaPath(image)
    : image;

  const isFailed = status === 'failed';
  const canRetry = isFailed && retryCount < MAX_RETRIES;

  return (
    <div className={`android-launch-card${status === 'unavailable' ? ' android-launch-card--unavailable' : ''}${isFailed ? ' android-launch-card--failed' : ''}`}>
      {imgSrc && <img className="android-launch-card__icon" src={imgSrc} alt={title} />}
      <h2 className="android-launch-card__title">{title}</h2>
      <div className="android-launch-card__status">
        {status === 'checking' && 'Checking...'}
        {status === 'launching' && 'Launching...'}
        {status === 'unavailable' && 'Not available on this device'}
        {isFailed && (
          <div className="android-launch-card__error">
            <span>Failed to open app</span>
            {canRetry
              ? <span className="android-launch-card__hint">Press OK to retry</span>
              : <span className="android-launch-card__hint">Press Back to return</span>
            }
          </div>
        )}
      </div>
    </div>
  );
};

export default AndroidLaunchCard;
