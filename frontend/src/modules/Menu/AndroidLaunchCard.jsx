// frontend/src/modules/Menu/AndroidLaunchCard.jsx
import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { isFKBAvailable, launchApp, onResume } from '../../lib/fkb.js';
import { DaylightMediaPath } from '../../lib/api.mjs';
import './AndroidLaunchCard.scss';

const AndroidLaunchCard = ({ android, title, image, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'AndroidLaunchCard' }), []);
  const [status, setStatus] = useState('checking'); // checking | launching | unavailable

  // Attempt launch on mount
  useEffect(() => {
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
    launchApp(android.package, android.activity);

    // Bind onResume to return to menu
    onResume(() => {
      logger.info('android-launch.returned', { package: android.package });
      onClose?.();
    });
  }, [android, logger, onClose]);

  // Escape key always dismisses
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'GamepadSelect') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const imgSrc = image && (image.startsWith('/media/') || image.startsWith('media/'))
    ? DaylightMediaPath(image)
    : image;

  const isUnavailable = status === 'unavailable';

  return (
    <div className={`android-launch-card${isUnavailable ? ' android-launch-card--unavailable' : ''}`}>
      {imgSrc && <img className="android-launch-card__icon" src={imgSrc} alt={title} />}
      <h2 className="android-launch-card__title">{title}</h2>
      <div className="android-launch-card__status">
        {status === 'checking' && 'Checking...'}
        {status === 'launching' && 'Launching...'}
        {status === 'unavailable' && 'Not available on this device'}
      </div>
    </div>
  );
};

export default AndroidLaunchCard;
