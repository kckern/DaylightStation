// frontend/src/modules/Media/DevicePanel.jsx
import React, { useEffect, useMemo } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import DeviceCard from './DeviceCard.jsx';
import getLogger from '../../lib/logging/Logger.js';

const DevicePanel = () => {
  const logger = useMemo(() => getLogger().child({ component: 'DevicePanel' }), []);
  const { devices, playbackStates, isLoading } = useDeviceMonitor();

  // Separate registered devices from browser-only clients
  const deviceIds = new Set(devices.map(d => d.id));
  const browserClients = [];
  playbackStates.forEach((state, id) => {
    if (!deviceIds.has(id) && !state.deviceId) {
      browserClients.push({ id, name: state.displayName || id, state });
    }
  });

  useEffect(() => {
    logger.info('device-panel.mounted', { deviceCount: devices.length });
    return () => logger.info('device-panel.unmounted');
  }, [logger]);

  useEffect(() => {
    if (!isLoading) {
      logger.info('device-panel.devices-updated', {
        registered: devices.length,
        browserClients: browserClients.length,
        deviceNames: devices.map(d => d.name || d.id),
      });
    }
  }, [devices.length, browserClients.length, isLoading, logger]);

  return (
    <div className="device-panel">
      <div className="device-panel-header">
        <h3>Devices</h3>
      </div>

      {isLoading && <div className="device-panel-loading">Loading devices...</div>}

      <div className="device-panel-list">
        {devices.map(device => (
          <DeviceCard
            key={device.id}
            device={device}
            playbackState={playbackStates.get(device.id)}
            isOnline={playbackStates.has(device.id)}
            type="device"
          />
        ))}

        {browserClients.length > 0 && (
          <>
            <div className="device-panel-divider">Also Playing</div>
            {browserClients.map(client => (
              <DeviceCard
                key={client.id}
                device={client}
                playbackState={client.state}
                isOnline={true}
                type="browser"
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default DevicePanel;
