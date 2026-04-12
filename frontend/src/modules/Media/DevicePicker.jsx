// frontend/src/modules/Media/DevicePicker.jsx
import React, { useMemo } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import getLogger from '../../lib/logging/Logger.js';

const DevicePicker = ({ open, onClose, contentId, onCastStarted, onDevicePicked }) => {
  const logger = useMemo(() => getLogger().child({ component: 'DevicePicker' }), []);
  const { devices, playbackStates } = useDeviceMonitor();

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  const handleCast = async (deviceId) => {
    const deviceObj = castableDevices.find(d => d.id === deviceId);

    // If onDevicePicked is provided, delegate to it (target-aware flow)
    if (onDevicePicked) {
      onDevicePicked(deviceId, deviceObj);
      return;
    }

    // Legacy flow — direct cast
    logger.info('cast.start', { deviceId, contentId });
    onCastStarted?.(deviceId);
    try {
      const params = new URLSearchParams({ open: '/media', play: contentId });
      const res = await fetch(`/api/v1/device/${deviceId}/load?${params}`);
      const result = await res.json();
      if (result.ok) {
        logger.info('cast.success', { deviceId, totalElapsedMs: result.totalElapsedMs });
      } else {
        logger.warn('cast.failed', { deviceId, error: result.error, failedStep: result.failedStep });
      }
    } catch (err) {
      logger.error('cast.error', { deviceId, error: err.message });
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="device-picker-overlay" onClick={onClose}>
      <div className="device-picker" onClick={e => e.stopPropagation()}>
        <div className="device-picker-header">
          <h3>Cast to device</h3>
        </div>
        <div className="device-picker-list">
          {castableDevices.map(device => {
            const state = playbackStates.get(device.id);
            const isOnline = playbackStates.has(device.id);
            return (
              <button
                key={device.id}
                className={`device-picker-item ${!isOnline ? 'device-picker-item--offline' : ''}`}
                onClick={() => handleCast(device.id)}
              >
                <span className={`device-card-status ${isOnline ? 'online' : 'offline'}`} />
                <span className="device-picker-name">{device.name || device.id}</span>
                {state && state.state !== 'stopped' && (
                  <span className="device-picker-playing">{state.title}</span>
                )}
              </button>
            );
          })}
          {castableDevices.length === 0 && (
            <div className="device-picker-empty">No castable devices found</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevicePicker;
