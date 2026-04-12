// frontend/src/modules/Media/CastButton.jsx
import React, { useState, useCallback, useMemo, useRef } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import { useCastTarget } from './useCastTarget.jsx';
import DevicePicker from './DevicePicker.jsx';
import CastPopover from './CastPopover.jsx';

const CastButton = ({ contentId, isCollection = false, className = '' }) => {
  const logger = useMemo(() => getLogger().child({ component: 'CastButton' }), []);
  const { device: targetDevice, selectDevice } = useCastTarget();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const btnRef = useRef(null);

  const handleToggle = useCallback((e) => {
    e.stopPropagation();
    if (targetDevice) {
      // Target set — toggle the per-cast popover
      logger.debug('cast-button.popover-toggle', { contentId });
      setPopoverOpen(o => !o);
    } else {
      // No target — open device picker to set one
      logger.debug('cast-button.picker-toggle', { contentId });
      setPickerOpen(o => !o);
    }
  }, [targetDevice, contentId, logger]);

  const handleDevicePicked = useCallback((deviceId, deviceObj) => {
    // Set the picked device as the sticky target
    if (deviceObj) {
      logger.info('cast-button.target-set-from-picker', { deviceId });
      selectDevice(deviceObj);
    }
    setPickerOpen(false);
    // Open the popover now that we have a target
    setPopoverOpen(true);
  }, [selectDevice, logger]);

  if (!contentId) return null;

  return (
    <span className="cast-btn-wrapper" style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className={`cast-btn ${className}`}
        onClick={handleToggle}
        aria-label="Cast to device"
        title={targetDevice ? `Cast to ${targetDevice.name}` : 'Cast to device'}
      >
        &#x1F4E1;
      </button>
      <DevicePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        contentId={contentId}
        onDevicePicked={handleDevicePicked}
      />
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
