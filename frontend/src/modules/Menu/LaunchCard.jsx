import { useState, useEffect, useMemo, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { DaylightMediaPath } from '../../lib/api.mjs';
import { isFKBAvailable, launchIntent, onResume } from '../../lib/fkb.js';
import './LaunchCard.scss';

const LOAD_MS = 3000;

const LaunchCard = ({ launch, title, thumbnail, metadata, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'LaunchCard' }), []);
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [nextWindow, setNextWindow] = useState(null);
  const progressRef = useRef(null);

  // Animated progress bar via Web Animations API (immune to TVApp CSS animation kill)
  useEffect(() => {
    if (status !== 'loading') return;
    const el = progressRef.current;
    if (!el) return;

    const anim = el.animate(
      [{ width: '0%' }, { width: '100%' }],
      { duration: LOAD_MS, fill: 'forwards', easing: 'ease-out' }
    );
    anim.onfinish = () => setStatus('launching');
    return () => anim.cancel();
  }, [status, retryCount]);

  // Fire launch when progress completes
  useEffect(() => {
    if (status !== 'launching') return;
    if (!launch?.contentId) return;

    const source = launch.contentId.split(':')[0] || 'retroarch';
    const deviceId = launch.targetDeviceId || window.__DAYLIGHT_DEVICE_ID || undefined;

    logger.info('launch.initiated', {
      contentId: launch.contentId,
      source,
      targetDeviceId: deviceId || null,
      title,
      retryCount,
    });

    fetch(`/api/v1/content/schedule/${source}`)
      .then(res => res.ok ? res.json() : null)
      .then(scheduleData => {
        if (scheduleData && !scheduleData.available) {
          logger.info('launch.blocked.schedule', { contentId: launch.contentId, nextWindow: scheduleData.nextWindow });
          setStatus('blocked');
          setNextWindow(scheduleData.nextWindow || null);
          return;
        }

        logger.debug('launch.schedule.ok', { contentId: launch.contentId, source });

        // If FKB is available, try to launch via intent (no ADB needed)
        if (isFKBAvailable()) {
          return fetch(`/api/v1/launch/intent/${launch.contentId}`)
            .then(r => r.ok ? r.json() : null)
            .then(intentData => {
              if (intentData?.target && intentData?.params) {
                const [pkg, activity] = intentData.target.split('/');
                const launched = launchIntent(pkg, activity, intentData.params);
                if (launched) {
                  logger.info('launch.fkb-intent', { contentId: launch.contentId, target: intentData.target });
                  setStatus('success');
                  onResume(() => onClose?.());
                  return; // Don't fall through to API launch
                }
              }
              // Intent not available — fall through to API launch below
              return doApiLaunch();
            })
            .catch(() => doApiLaunch());
        }

        return doApiLaunch();

        function doApiLaunch() {
          const payload = {
            contentId: launch.contentId,
            ...(deviceId && { targetDeviceId: deviceId })
          };
          logger.info('launch.api.request', payload);

          return fetch('/api/v1/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
            .then(res => {
              if (!res.ok) return res.json().then(d => Promise.reject(d));
              return res.json();
            })
            .then(data => {
              if (!data) return;
              logger.info('launch.success', {
                contentId: launch.contentId,
                title: data.title,
                targetDeviceId: data.targetDeviceId || deviceId,
              });
              setStatus('success');
              setTimeout(() => onClose?.(), 1500);
            });
        }
      })
      .catch(errData => {
        const message = errData?.error || errData?.message || 'Launch failed';
        if (errData?.code === 'OUTSIDE_SCHEDULE') {
          logger.info('launch.blocked.schedule', { contentId: launch.contentId, nextWindow: errData.details?.nextWindow });
          setStatus('blocked');
          setNextWindow(errData.details?.nextWindow || null);
        } else {
          logger.error('launch.failed', {
            contentId: launch.contentId,
            targetDeviceId: deviceId || null,
            error: message,
            code: errData?.code,
            details: errData?.details,
          });
          setStatus('error');
          setErrorMsg(message);
        }
      });
  }, [status, launch?.contentId, retryCount]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = e.key;
      const isBack = key === 'Escape' || key === 'GamepadSelect';
      const isSelect = key === 'Enter' || key === ' '
        || key === 'GamepadA' || key === 'GamepadB'
        || key === 'GamepadX' || key === 'GamepadY'
        || key === 'GamepadL1' || key === 'GamepadR1'
        || key === 'GamepadStart';

      if (isBack) {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (status === 'blocked' && (isSelect || e.code === 'MediaPlayPause')) {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, status]);

  const sonicGif = DaylightMediaPath('media/img/ui/sonic-nonono.gif');

  const formatNextWindow = (nw) => {
    if (!nw) return '';
    const [h, m] = nw.start.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = m > 0 ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
    const dayStr = nw.day.charAt(0).toUpperCase() + nw.day.slice(1);
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    if (nw.day === today) return timeStr;
    return `${dayStr} at ${timeStr}`;
  };

  return (
    <div className={`launch-card${status === 'blocked' ? ' launch-card--blocked' : ''}`}>
      {status === 'blocked' ? (
        <>
          <img className="launch-card__art" src={sonicGif} alt="Not right now!" />
          <div className="launch-card__info">
            <h2 className="launch-card__title">No, no, no!<br/><small style={{color:"grey"}}>Too many games!</small></h2>
          </div>
        </>
      ) : (
        <>
          {thumbnail && <img className="launch-card__art" src={thumbnail} alt={title} />}
          <div className="launch-card__info">
            <h2 className="launch-card__title">{title}</h2>
            {metadata?.parentTitle && <p className="launch-card__console">{metadata.parentTitle}</p>}
          </div>
          <div className="launch-card__progress-track">
            <div className="launch-card__progress-fill" ref={progressRef} />
          </div>
          <div className="launch-card__status">
            {status === 'loading' && <span className="launch-card__spinner">Loading...</span>}
            {status === 'launching' && <span className="launch-card__spinner">Launching...</span>}
            {status === 'success' && <span className="launch-card__success">Launched</span>}
            {status === 'error' && (
              <div className="launch-card__error">
                <span>{errorMsg}</span>
                <button onClick={() => { logger.info('launch.retry', { contentId: launch?.contentId, retryCount: retryCount + 1 }); setStatus('loading'); setErrorMsg(null); setRetryCount(c => c + 1); }}>Retry</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default LaunchCard;
