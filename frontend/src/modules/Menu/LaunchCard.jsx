import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import './LaunchCard.scss';

const LaunchCard = ({ launch, title, thumbnail, metadata, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'LaunchCard' }), []);
  const [status, setStatus] = useState('launching'); // 'launching' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!launch?.contentId) return;

    logger.info('launch.initiated', { contentId: launch.contentId });

    const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || 'default';

    fetch('/api/v1/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId: launch.contentId, targetDeviceId: deviceId })
    })
      .then(res => {
        if (!res.ok) return res.json().then(d => Promise.reject(new Error(d.error || 'Launch failed')));
        return res.json();
      })
      .then(data => {
        logger.info('launch.success', { contentId: launch.contentId, title: data.title });
        setStatus('success');
      })
      .catch(err => {
        logger.error('launch.failed', { contentId: launch.contentId, error: err.message });
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, [launch?.contentId]);

  return (
    <div className="launch-card">
      {thumbnail && <img className="launch-card__art" src={thumbnail} alt={title} />}
      <div className="launch-card__info">
        <h2 className="launch-card__title">{title}</h2>
        {metadata?.parentTitle && <p className="launch-card__console">{metadata.parentTitle}</p>}
      </div>
      <div className="launch-card__status">
        {status === 'launching' && <span className="launch-card__spinner">Launching...</span>}
        {status === 'success' && <span className="launch-card__success">Launched</span>}
        {status === 'error' && (
          <div className="launch-card__error">
            <span>{errorMsg}</span>
            <button onClick={() => { setStatus('launching'); setErrorMsg(null); }}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaunchCard;
