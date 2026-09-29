// frontend/src/modules/Menu/AndroidLaunchCard.jsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { isFKBAvailable, launchApp, launchAndroidTarget, onResume } from '../../lib/fkb.js';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import './AndroidLaunchCard.scss';

const VERIFY_DELAY_MS = 2500;
const MAX_RETRIES = 2;
// Upper bound on holding the launch for the excursion notice. The page's JS is
// suspended the moment the app takes the foreground, so the notice has to land
// first — but a slow or absent backend must never keep the app from opening.
const EXCURSION_NOTICE_MS = 1500;

/**
 * Tell the backend this kiosk is about to leave for another app, so it can
 * guard the trip (see backend AndroidExcursionGuard). Resolves either way.
 */
function announceExcursion(android, logger) {
  const deviceId = window.__DAYLIGHT_DEVICE_ID;
  if (!deviceId) return Promise.resolve();
  const notice = DaylightAPI(`api/v1/device/${encodeURIComponent(deviceId)}/excursion`,
    { package: android.package, activity: android.activity || '' }, 'POST')
    .then((result) => logger.info('android-launch.excursion-announced', { package: android.package, guarded: !!result?.guarded, reason: result?.reason }))
    .catch((err) => logger.warn('android-launch.excursion-announce-failed', { package: android.package, error: err.message }));
  return Promise.race([notice, new Promise((resolve) => setTimeout(resolve, EXCURSION_NOTICE_MS))]);
}

const AndroidLaunchCard = ({ android, title, image, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'AndroidLaunchCard' }), []);
  const [status, setStatus] = useState('checking'); // checking | launching | success | failed | unavailable
  const [retryCount, setRetryCount] = useState(0);
  const verifyTimerRef = useRef(null);
  // Bumped when an attempt is abandoned (unmount / retry), so a launch still
  // waiting on the excursion notice does not fire after Back closed the card.
  const attemptRef = useRef(0);

  const attemptLaunch = useCallback(async () => {
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
    const attempt = attemptRef.current;
    await announceExcursion(android, logger);
    if (attempt !== attemptRef.current) {
      logger.info('android-launch.abandoned', { package: android.package });
      return;
    }
    // An entry that names an activity opens exactly that screen (e.g. Settings'
    // pairing screen); one that names only a package opens the app's front door.
    const via = android.activity ? 'component' : 'package';
    logger.info('android-launch.attempt', { package: android.package, activity: android.activity || null, via });
    const launched = via === 'component'
      ? launchAndroidTarget({ package: android.package, activity: android.activity })
      : launchApp(android.package);

    if (!launched) {
      logger.error('android-launch.launch-returned-false', { package: android.package, via });
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
    return () => { attemptRef.current += 1; clearTimeout(verifyTimerRef.current); };
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
