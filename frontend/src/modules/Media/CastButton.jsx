// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useCallback } from 'react';
import DevicePicker from './DevicePicker.jsx';

const CastButton = ({ contentId, className = '' }) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    setPickerOpen(o => !o);
  }, []);

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
