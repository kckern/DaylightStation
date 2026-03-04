// frontend/src/modules/Media/DeviceCard.jsx
import React, { useCallback, useMemo } from 'react';
import { notifications } from '@mantine/notifications';
import getLogger from '../../lib/logging/Logger.js';

const DeviceCard = ({ device, playbackState, isOnline, type }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DeviceCard' }), []);
  const isDevice = type === 'device';

  const handlePower = useCallback(() => {
    const action = isOnline ? 'off' : 'on';
    logger.info('device-card.power', { deviceId: device.id, action });
    fetch(`/api/v1/device/${device.id}/${action}`).catch(err => {
      logger.error('device-card.power-failed', { error: err.message });
      notifications.show({ title: 'Device command failed', message: err.message, color: 'red' });
    });
  }, [device.id, isOnline, logger]);

  const handleVolume = useCallback((e) => {
    const level = Math.round(parseFloat(e.target.value) * 100);
    logger.debug('device-card.volume-change', { deviceId: device.id, level });
    fetch(`/api/v1/device/${device.id}/volume/${level}`).catch(err => {
      logger.error('device-card.volume-failed', { error: err.message });
      notifications.show({ title: 'Volume change failed', message: err.message, color: 'red' });
    });
  }, [device.id, logger]);

  const progress = useMemo(() => {
    if (!playbackState?.duration || playbackState.duration <= 0) return 0;
    return (playbackState.position / playbackState.duration) * 100;
  }, [playbackState?.position, playbackState?.duration]);

  return (
    <div className={`device-card ${!isOnline ? 'device-card--offline' : ''} ${!isDevice ? 'device-card--browser' : ''}`}>
      <div className="device-card-header">
        <span className={`device-card-status ${isOnline ? 'online' : 'offline'}`} />
        <span className="device-card-name">{device.name || device.id}</span>
        {!isDevice && <span className="device-card-badge">Browser</span>}
      </div>

      {playbackState && playbackState.state !== 'stopped' && (
        <div className="device-card-playing">
          <div className="device-card-title">{playbackState.title}</div>
          <div className="device-card-progress">
            <div className="device-card-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {!playbackState && isOnline && (
        <div className="device-card-idle">Idle</div>
      )}

      {isDevice && (
        <div className="device-card-controls">
          {device.capabilities?.deviceControl && (
            <button className="device-card-btn" onClick={handlePower} aria-label="Power">
              &#x23FB;
            </button>
          )}
          {isOnline && device.capabilities?.deviceControl && (
            <input
              type="range" min="0" max="1" step="0.05"
              className="device-card-volume"
              onChange={handleVolume}
              aria-label="Volume"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DeviceCard;
