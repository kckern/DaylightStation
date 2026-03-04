// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useCallback, useMemo } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import DevicePicker from './DevicePicker.jsx';

const CastButton = ({ contentId, className = '' }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastButton' }), []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    const opening = !pickerOpen;
    logger.debug('cast-button.toggle', { contentId, opening });
    setPickerOpen(o => !o);
  }, [pickerOpen, contentId, logger]);

  if (!contentId) return null;

  return (
    <>
      <button
        className={`cast-btn ${className}`}
        onClick={handleToggle}
        aria-label="Cast to device"
        title="Cast to device"
      >
        &#x1F4E1;
      </button>
      <DevicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        contentId={contentId}
      />
    </>
  );
};

export default CastButton;
