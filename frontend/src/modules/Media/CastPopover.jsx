// frontend/src/modules/Media/CastPopover.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useCastTarget } from './useCastTarget.jsx';
import { useDeviceMonitor } from '../../hooks/media/useDeviceMonitor.js';

const SHADER_OPTIONS = [
  { value: null, label: 'off' },
  { value: 'focused', label: 'focused' },
  { value: 'night', label: 'night' },
  { value: 'dark', label: 'dark' },
];

const CastPopover = ({ contentId, isCollection, open, onClose, anchorRef }) => {
  const { device, settings, selectDevice, updateSettings, castToTarget } = useCastTarget();
  const { devices } = useDeviceMonitor();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const popoverRef = useRef(null);

  const castableDevices = useMemo(
    () => devices.filter(d => d.capabilities?.contentControl),
    [devices]
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const handleCast = () => {
    if (!device) return;
    castToTarget(contentId, { shuffle, repeat });
    onClose();
  };

  // Build config tags for the button
  const configTags = [];
  if (shuffle) configTags.push('shuffle');
  if (repeat) configTags.push('repeat');
  if (settings.shader) configTags.push(settings.shader);
  if (settings.volume != null) configTags.push(`vol ${settings.volume}`);

  const hasShader = device && ['shield-tv', 'linux-pc', 'kiosk', 'tablet'].some(t => (device.type || '').includes(t));
  const hasVolume = device && !!(device.capabilities?.deviceControl || device.capabilities?.osControl);

  return (
    <div className="cast-popover" ref={popoverRef}>
      {/* Device selection */}
      <div className="cast-popover__devices">
        {castableDevices.map(dev => (
          <button
            key={dev.id}
            className={`cast-popover__device-btn ${device?.id === dev.id ? 'cast-popover__device-btn--selected' : ''}`}
            onClick={() => selectDevice(dev)}
          >
            {dev.type?.includes('shield') || dev.type?.includes('tv') ? '📺' :
             dev.type?.includes('pc') || dev.type?.includes('linux') ? '🖥️' :
             dev.type?.includes('audio') ? '🔊' : '📡'}
            {' '}{dev.name || dev.id}
          </button>
        ))}
      </div>

      {/* Config options — only shown when device selected */}
      {device && (
        <>
          {/* Shader */}
          {hasShader && (
            <div className="cast-popover__config-row">
              <span className="cast-popover__config-label">Shader</span>
              <div className="cast-popover__pills">
                {SHADER_OPTIONS.map(opt => (
                  <button
                    key={opt.label}
                    className={`cast-popover__pill ${settings.shader === opt.value ? 'cast-popover__pill--active' : ''}`}
                    onClick={() => updateSettings({ shader: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Volume */}
          {hasVolume && (
            <div className="cast-popover__config-row">
              <span className="cast-popover__config-label">Vol</span>
              <input
                type="range"
                className="cast-popover__volume-slider"
                min="0" max="100"
                value={settings.volume ?? 50}
                onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
              />
              <span className="cast-popover__volume-val">{settings.volume ?? 50}</span>
            </div>
          )}

          {/* Playback toggles */}
          {isCollection && (
            <div className="cast-popover__toggles">
              <label className="cast-popover__toggle">
                <span
                  className={`cast-popover__switch ${shuffle ? 'cast-popover__switch--on' : ''}`}
                  onClick={() => setShuffle(s => !s)}
                  role="switch"
                  aria-checked={shuffle}
                />
                <span className="cast-popover__toggle-label">Shuffle</span>
              </label>
              <label className="cast-popover__toggle">
                <span
                  className={`cast-popover__switch ${repeat ? 'cast-popover__switch--on' : ''}`}
                  onClick={() => setRepeat(r => !r)}
                  role="switch"
                  aria-checked={repeat}
                />
                <span className="cast-popover__toggle-label">Repeat</span>
              </label>
            </div>
          )}

          {/* Cast button with full config summary */}
          <button className="cast-popover__cast-btn" onClick={handleCast}>
            <span className="cast-popover__cast-label">&#x25B6; Cast to {device.name || device.id}</span>
            {configTags.length > 0 && (
              <span className="cast-popover__cast-config">
                {configTags.join(' · ')}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
};

export default CastPopover;
