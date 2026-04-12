// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useMemo, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import CastPopover from './CastPopover.jsx';

const CastButton = ({ contentId, isCollection = false, className = '' }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastButton' }), []);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const btnRef = useRef(null);

  const handleToggle = (e) => {
    e.stopPropagation();
    logger.debug('cast-button.toggle', { contentId });
    setPopoverOpen(o => !o);
  };

  if (!contentId) return null;

  return (
    <span className="cast-btn-wrapper">
      <button
        ref={btnRef}
        className={`cast-btn ${className}`}
        onClick={handleToggle}
        aria-label="Cast to device"
        title="Cast to device"
      >
        &#x1F4E1;
      </button>
      <CastPopover
        contentId={contentId}
        isCollection={isCollection}
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        anchorRef={btnRef}
      />
    </span>
  );
};

export default CastButton;
