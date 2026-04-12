// frontend/src/modules/Media/CastTargetPanel.jsx
import React, { useMemo, useEffect, useRef } from 'react';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';
import { useCastTarget } from './useCastTarget.jsx';
import getLogger from '../../lib/logging/Logger.js';

const SHADER_OPTIONS = [
  { value: null, label: 'off' },
  { value: 'focused', label: 'focused' },
  { value: 'night', label: 'night' },
  { value: 'dark', label: 'dark' },
];

/**
 * Determine which settings a device supports based on its type and capabilities.
 */
function getDeviceFeatures(dev) {
  if (!dev) return { hasShader: false, hasVolume: false };
  const type = dev.type || '';
  const caps = dev.capabilities || {};

  // Screen-type devices support shader
  const screenTypes = ['shield-tv', 'linux-pc', 'kiosk', 'tablet'];
  const hasShader = caps.contentControl && screenTypes.some(t => type.includes(t));

  // Volume needs device or OS control
  const hasVolume = !!(caps.deviceControl || caps.osControl);

  return { hasShader, hasVolume };
}

const CastTargetPanel = ({ open, onClose }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastTargetPanel' }), []);
  const { devices } = useDeviceMonitor();
  const { device: selectedDevice, settings, selectDevice, updateSettings, clearTarget } = useCastTarget();
  const panelRef = useRef(null);

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  if (!open) return null;

  const features = getDeviceFeatures(selectedDevice);
  const hasSettings = features.hasShader || features.hasVolume;

  return (
    <div className="cast-target-panel" ref={panelRef}>
      {/* Device List */}
      <div className="cast-target-panel__section-label">Devices</div>
      <div className="cast-target-panel__devices">
        {castableDevices.map(dev => {
          const isSelected = selectedDevice?.id === dev.id;
          return (
            <button
              key={dev.id}
              className={`cast-target-panel__device ${isSelected ? 'cast-target-panel__device--selected' : ''}`}
              onClick={() => {
                logger.info('cast-panel.select-device', { id: dev.id });
                selectDevice(dev);
              }}
            >
              <span className="cast-target-panel__device-icon">
                {dev.type?.includes('shield') || dev.type?.includes('tv') ? '📺' :
                 dev.type?.includes('pc') || dev.type?.includes('linux') ? '🖥️' :
                 dev.type?.includes('audio') ? '🔊' :
                 dev.type?.includes('mobile') ? '📱' : '📡'}
              </span>
              <div className="cast-target-panel__device-info">
                <div className="cast-target-panel__device-name">{dev.name || dev.id}</div>
                <div className="cast-target-panel__device-type">{dev.type || 'device'}</div>
              </div>
            </button>
          );
        })}
        {castableDevices.length === 0 && (
          <div className="cast-target-panel__empty">No castable devices found</div>
        )}
      </div>

      {/* Settings for selected device */}
      {selectedDevice && hasSettings && (
        <>
          <div className="cast-target-panel__section-label">
            Settings for {selectedDevice.name || selectedDevice.id}
          </div>
          <div className="cast-target-panel__settings">
            {features.hasShader && (
              <div className="cast-target-panel__setting">
                <span className="cast-target-panel__setting-label">Shader</span>
                <div className="cast-target-panel__shader-pills">
                  {SHADER_OPTIONS.map(opt => (
                    <button
                      key={opt.label}
                      className={`cast-target-panel__pill ${settings.shader === opt.value ? 'cast-target-panel__pill--active' : ''}`}
                      onClick={() => updateSettings({ shader: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {features.hasVolume && (
              <div className="cast-target-panel__setting">
                <span className="cast-target-panel__setting-label">Vol</span>
                <input
                  type="range"
                  className="cast-target-panel__volume"
                  min="0"
                  max="100"
                  value={settings.volume ?? 50}
                  onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
                />
                <span className="cast-target-panel__volume-value">{settings.volume ?? 50}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Clear target */}
      {selectedDevice && (
        <button className="cast-target-panel__clear" onClick={() => { clearTarget(); onClose(); }}>
          Clear target
        </button>
      )}
    </div>
  );
};

export default CastTargetPanel;
