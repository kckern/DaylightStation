// frontend/src/modules/Media/CastPopover.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useCastTarget } from './useCastTarget.jsx';

const CastPopover = ({ contentId, isCollection, open, onClose, anchorRef }) => {
  const { device, settings, castToTarget } = useCastTarget();
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const popoverRef = useRef(null);

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

  if (!open || !device) return null;

  const handleCast = () => {
    castToTarget(contentId, { shuffle, repeat });
    onClose();
  };

  const settingsSummary = [
    settings.shader ? `${settings.shader}` : null,
    settings.volume != null ? `vol ${settings.volume}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="cast-popover" ref={popoverRef}>
      <div className="cast-popover__header">
        <span className="cast-popover__label">Sending to</span>
        <span className="cast-popover__device">{device.name}</span>
        {settingsSummary && (
          <span className="cast-popover__settings">{settingsSummary}</span>
        )}
      </div>

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

      <button className="cast-popover__cast-btn" onClick={handleCast}>
        &#x25B6; Cast Now
      </button>
    </div>
  );
};

export default CastPopover;
