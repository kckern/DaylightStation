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

  // Build config tags that will show on the button
  const configTags = [];
  if (shuffle) configTags.push('shuffle');
  if (repeat) configTags.push('repeat');
  if (settings.shader) configTags.push(settings.shader);
  if (settings.volume != null) configTags.push(`vol ${settings.volume}`);

  return (
    <div className="cast-popover" ref={popoverRef}>
      <div className="cast-popover__header">
        <span className="cast-popover__device">{device.name || device.id}</span>
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
        <span className="cast-popover__cast-label">&#x25B6; Cast Now</span>
        {configTags.length > 0 && (
          <span className="cast-popover__cast-config">
            {configTags.join(' · ')}
          </span>
        )}
      </button>
    </div>
  );
};

export default CastPopover;
