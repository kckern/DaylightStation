import React from 'react';
import { useDispatchTargetPicker } from './useDispatchTargetPicker.js';

export function DispatchTargetPicker({ source, onComplete, autoFocus = true, submitLabel = 'Cast' }) {
  const { devices, selected, mode, canSubmit, toggle, setMode, submit } = useDispatchTargetPicker({ source, onComplete });

  return (
    <div data-testid="dispatch-target-picker" className="dispatch-target-picker">
      <div className="picker-section picker-section--devices">
        <div className="picker-section-label">Target device</div>
        {devices.length === 0 && (
          <div data-testid="picker-no-devices" className="picker-empty">No devices configured.</div>
        )}
        {devices.map((d) => (
          <label
            key={d.id}
            data-testid={`picker-device-${d.id}`}
            className={`picker-device ${selected.has(d.id) ? 'picker-device--selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(d.id)}
              onChange={() => toggle(d.id)}
            />
            <span className="picker-device-name">{d.name}</span>
            <span className="picker-device-location">{d.location ?? ''}</span>
          </label>
        ))}
      </div>
      <div className="picker-section picker-section--mode">
        <div className="picker-section-label">Mode</div>
        <label data-testid="picker-mode-transfer" className="picker-mode">
          <input type="radio" name="dispatch-mode" checked={mode === 'transfer'} onChange={() => setMode('transfer')} />
          <span>Transfer (local stops)</span>
        </label>
        <label data-testid="picker-mode-fork" className="picker-mode">
          <input type="radio" name="dispatch-mode" checked={mode === 'fork'} onChange={() => setMode('fork')} />
          <span>Fork (local keeps playing)</span>
        </label>
      </div>
      <button
        data-testid="picker-submit"
        className="picker-submit"
        autoFocus={autoFocus}
        disabled={!canSubmit}
        onClick={submit}
      >
        {submitLabel}
      </button>
    </div>
  );
}

export default DispatchTargetPicker;
