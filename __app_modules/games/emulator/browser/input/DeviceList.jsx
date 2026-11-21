// DeviceList — the Bluetooth screen's left column: one tall row per paired
// device (name, where it lives or what it is, one status word with a solid
// dot at the right edge), then "How to pair" rows for configured controllers
// that are not paired, then Search for devices. Picking a row shows that
// device's page beside the list.
import React from 'react';

export function DeviceList({ rows, selected, onSelect, hints = [], onGuide, onSearch, checking = false }) {
  return (
    <nav className="bts-devices" aria-label="Paired devices">
      {checking ? <p className="bts-empty">Checking Bluetooth…</p> : null}
      {!checking && !rows.length ? <p className="bts-empty">No Bluetooth devices paired yet.</p> : null}
      {rows.length ? (
        <ul className="bts-device-list">
          {rows.map((r) => {
            const isSel = r.address === selected;
            return (
              <li key={r.address}>
                <button
                  type="button"
                  className={`bts-device${isSel ? ' is-selected' : ''}`}
                  data-address={r.address}
                  data-status={r.status}
                  aria-current={isSel ? 'true' : undefined}
                  data-autofocus={isSel ? '' : undefined}
                  onClick={() => onSelect(r)}
                >
                  <span className="bts-device-text">
                    <span className="bts-device-line">
                      <span className="bts-device-name">{r.name}</span>
                      <span className={`bts-device-status bts-status-${r.status}`}>
                        <span className="bts-dot" aria-hidden="true" />
                        {r.statusText}
                      </span>
                    </span>
                    <span className="bts-device-detail">{r.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hints.length ? (
        <ul className="bts-device-list bts-hint-list" aria-label="How to pair">
          {hints.map((h) => (
            <li key={h.id}>
              <button type="button" className="bts-device bts-device--hint" onClick={() => onGuide(h)}>
                <span className="bts-device-text">
                  <span className="bts-device-name">How to pair {h.label}</span>
                  {h.mode ? <span className="bts-device-detail">{h.mode}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="bts-device bts-device--search" data-autofocus={selected ? undefined : ''} onClick={onSearch}>
        <span className="bts-device-text"><span className="bts-device-name">Search for devices</span></span>
      </button>
    </nav>
  );
}

export default DeviceList;
