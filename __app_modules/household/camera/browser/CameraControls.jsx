// frontend/src/modules/CameraFeed/CameraControls.jsx
import { useState, useEffect, useRef } from 'react';

import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';

export default function CameraControls({ cameraId, logger }) {
  const path = `/api/v1/camera/${encodeURIComponent(cameraId)}/controls`;
  const { data, reload } = useApiResource(path);
  const controls = data?.controls || [];
  const [confirming, setConfirming] = useState(null);
  const timer = useRef(null);
  const [commandError, setCommandError] = useState(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function execute(controlId, action) {
    setCommandError(null);
    try {
      const result = await DaylightAPI(`${path}/${encodeURIComponent(controlId)}`, { action }, 'POST');
      if (result?.ok === false) throw new Error(result.error || 'Camera control failed');
      logger.info?.('controls.executed', { controlId, action });
      reload();
    } catch (err) {
      setCommandError(err.message);
      logger.warn?.('controls.executeError', { controlId, error: err.message });
    }
  }

  function handleClick(ctrl) {
    if (ctrl.type === 'siren') {
      clearTimeout(timer.current);
      if (confirming === ctrl.id) {
        setConfirming(null);
        execute(ctrl.id, 'trigger');
      } else {
        setConfirming(ctrl.id);
        timer.current = setTimeout(() => setConfirming(null), 3000);
      }
    } else {
      execute(ctrl.id, ctrl.state === 'on' ? 'off' : 'on');
    }
  }

  if (controls.length === 0) return null;

  return (
    <div className="camera-viewport__controls">
      {commandError && <span role="alert">{commandError}</span>}
      {controls.map(ctrl => (
        <button
          key={ctrl.id}
          className={`camera-viewport__control-btn camera-viewport__control-btn--${ctrl.type} ${ctrl.state === 'on' ? 'active' : ''} ${confirming === ctrl.id ? 'confirming' : ''}`}
          onClick={() => handleClick(ctrl)}
          aria-label={confirming === ctrl.id ? `Confirm ${ctrl.label}` : ctrl.label}
          title={ctrl.label}
        >
          {ctrl.type === 'light' ? '\u{1F4A1}' : '\u{1F514}'}
          {confirming === ctrl.id && <span className="camera-viewport__confirm-label">Confirm?</span>}
        </button>
      ))}
    </div>
  );
}
