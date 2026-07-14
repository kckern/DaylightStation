// frontend/src/modules/Media/cast/DispatchTargetPicker.jsx
// Tap-a-device cast picker. Tiles show what each device IS (icon, friendly
// name, room) and what it's DOING (live fleet snapshot) — never a raw kebab
// id. One tap selects, the CTA says exactly what will happen ("Cast to
// Living Room TV"), and a busy device warns before it gets steamrolled.
// Transfer/fork jargon never reaches the screen: when something is playing
// locally the choice reads "Move playback…" vs "Keep playing here too".
// One component for inline cast (rows), the detail page, and hand-off.
import React from 'react';
import { useDispatchTargetPicker } from './useDispatchTargetPicker.js';
import { useDevice } from '../fleet/useDevice.js';
import { deviceName, deviceIcon, deviceLocation } from '../fleet/deviceDisplay.js';
import { deviceStatusLine, describeBusy } from './castCopy.js';
import './Cast.scss';

function DeviceTile({ device, pressed, onSelect }) {
  const { entry } = useDevice(device.id);
  const status = deviceStatusLine(entry);
  const location = deviceLocation(device);
  return (
    <button
      type="button"
      data-testid={`picker-device-${device.id}`}
      className={`cast-tile ${pressed ? 'cast-tile--selected' : ''}`}
      aria-pressed={pressed}
      onClick={() => onSelect(device.id)}
    >
      <span className="cast-tile-icon" aria-hidden>{deviceIcon(device)}</span>
      <span className="cast-tile-main">
        <span className="cast-tile-name">{deviceName(device)}</span>
        {location && <span className="cast-tile-location">{location}</span>}
        {status && (
          <span
            className={`cast-tile-status cast-tile-status--${status.tone}`}
            data-testid={`picker-device-status-${device.id}`}
          >
            {status.text}
          </span>
        )}
      </span>
      <span className="cast-tile-check" aria-hidden>{pressed ? '✓' : ''}</span>
    </button>
  );
}

// Warns only when we KNOW the device is mid-something (snapshot present);
// no snapshot means unknown, and unknown must not cry wolf.
function BusyWarning({ device }) {
  const { entry } = useDevice(device.id);
  const busy = describeBusy(entry);
  if (!busy) return null;
  return (
    <div
      role="status"
      data-testid={`cast-busy-warning-${device.id}`}
      className="cast-picker-warning"
    >
      {deviceName(device)} is {busy.phrase} — casting will replace it
    </div>
  );
}

export function DispatchTargetPicker({ source, onComplete, autoFocus = true, verb = 'Cast' }) {
  const {
    devices, selected, multi, mode, canSubmit, localPlaying,
    select, toggleMulti, setMode, submit,
  } = useDispatchTargetPicker({ source, onComplete });

  const selectedDevices = devices.filter((d) => selected.has(d.id));
  const targetLabel = selectedDevices.length === 1
    ? deviceName(selectedDevices[0])
    : selectedDevices.length > 1
      ? `${selectedDevices.length} devices`
      : null;

  return (
    <div data-testid="dispatch-target-picker" className="cast-picker">
      <div className="cast-picker-label">Cast to</div>
      {devices.length === 0 && (
        <div data-testid="picker-no-devices" className="cast-picker-empty">No devices available.</div>
      )}
      <div className="cast-picker-devices">
        {devices.map((d) => (
          <DeviceTile key={d.id} device={d} pressed={selected.has(d.id)} onSelect={select} />
        ))}
      </div>
      {devices.length > 1 && (
        <button
          type="button"
          data-testid="picker-multi-toggle"
          className="cast-picker-multi"
          aria-pressed={multi}
          onClick={toggleMulti}
        >
          + cast to more than one
        </button>
      )}
      {selectedDevices.map((d) => <BusyWarning key={d.id} device={d} />)}
      {localPlaying && devices.length > 0 && (
        <div className="cast-picker-mode" role="radiogroup" aria-label="What happens to playback here">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'transfer'}
            data-testid="picker-mode-transfer"
            className={`cast-picker-mode-option ${mode === 'transfer' ? 'cast-picker-mode-option--on' : ''}`}
            onClick={() => setMode('transfer')}
          >
            Move playback to {targetLabel ?? 'device'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'fork'}
            data-testid="picker-mode-fork"
            className={`cast-picker-mode-option ${mode === 'fork' ? 'cast-picker-mode-option--on' : ''}`}
            onClick={() => setMode('fork')}
          >
            Keep playing here too
          </button>
        </div>
      )}
      <button
        type="button"
        data-testid="picker-submit"
        className="cast-picker-cta"
        autoFocus={autoFocus}
        disabled={!canSubmit}
        onClick={submit}
      >
        {canSubmit ? `${verb} to ${targetLabel}` : 'Select a device'}
      </button>
    </div>
  );
}

export default DispatchTargetPicker;
