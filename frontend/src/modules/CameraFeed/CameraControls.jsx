// frontend/src/modules/CameraFeed/CameraControls.jsx
import { useState, useEffect, useCallback } from 'react';

export default function CameraControls({ cameraId, logger }) {
  const [controls, setControls] = useState([]);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    fetch(`/api/v1/camera/${cameraId}/controls`)
      .then(r => r.json())
      .then(data => setControls(data.controls || []))
      .catch(err => logger.warn?.('controls.fetchError', { error: err.message }));
  }, [cameraId, logger]);

  const execute = useCallback(async (controlId, action) => {
    try {
      await fetch(`/api/v1/camera/${cameraId}/controls/${controlId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      logger.info?.('controls.executed', { controlId, action });
      // Refresh controls state
      const res = await fetch(`/api/v1/camera/${cameraId}/controls`);
      const data = await res.json();
      setControls(data.controls || []);
    } catch (err) {
      logger.warn?.('controls.executeError', { controlId, error: err.message });
    }
  }, [cameraId, logger]);

  const handleClick = useCallback((ctrl) => {
    if (ctrl.type === 'siren') {
      if (confirming === ctrl.id) {
        execute(ctrl.id, 'trigger');
        setConfirming(null);
      } else {
        setConfirming(ctrl.id);
        setTimeout(() => setConfirming(prev => prev === ctrl.id ? null : prev), 3000);
      }
    } else {
      execute(ctrl.id, ctrl.state === 'on' ? 'off' : 'on');
    }
  }, [confirming, execute]);

  if (controls.length === 0) return null;

  return (
    <div className="camera-viewport__controls">
      {controls.map(ctrl => (
        <button
          key={ctrl.id}
          className={`camera-viewport__control-btn camera-viewport__control-btn--${ctrl.type} ${ctrl.state === 'on' ? 'active' : ''} ${confirming === ctrl.id ? 'confirming' : ''}`}
          onClick={() => handleClick(ctrl)}
          title={ctrl.label}
        >
          {ctrl.type === 'light' ? '\u{1F4A1}' : '\u{1F514}'}
          {confirming === ctrl.id && <span className="camera-viewport__confirm-label">Confirm?</span>}
        </button>
      ))}
    </div>
  );
}
