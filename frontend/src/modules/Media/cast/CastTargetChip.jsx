// frontend/src/modules/Media/cast/CastTargetChip.jsx
// The header's destination control: "Playing on <name> ⌄". It says where the
// next Play goes — this browser's own name, "this device" when it has none, or
// "Kitchen + Living Room" for several screens — and opens the cast
// preferences: the preferred target device(s) and the default Transfer/Fork
// mode, persisted per browser. Inline cast pickers seed from these so a
// configured household is one tap per cast. It absorbs the old cast icon; the
// first-use naming popover anchors to it (identity/FirstUseCard.jsx).
import React, { useState, useCallback, useContext, useEffect } from 'react';
import { Popover, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { useDismissLayer } from '../shell/useDismissLayer.js';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { deviceName } from '../fleet/deviceDisplay.js';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';
import { destinationName } from './AimLabel.jsx';
import { useDestinationInteraction } from './destinationInteraction.js';
import './Cast.scss';

export function CastTargetChip() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissLayer(open, close);
  const { mode, targetIds, setMode, toggleTarget } = useCastTarget();
  const { devices } = useFleetContext();
  const identity = useContext(ClientIdentityContext);
  const { setActive } = useDestinationInteraction();
  // An open search stays open while this control is in use: raised at the press
  // (before the field blurs) and held while the popover is open.
  useEffect(() => { setActive(open); }, [open, setActive]);
  useEffect(() => () => setActive(false), [setActive]);
  const name = destinationName(targetIds, devices, identity?.displayName ?? identity?.name ?? null);

  const control = (
    <UnstyledButton
      data-testid="cast-target-chip"
      className="media-destination"
      aria-label={`Playing on ${name}. Change where things play`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerDown={() => setActive(true)}
      onPointerCancel={() => { if (!open) setActive(false); }}
      onPointerLeave={() => { if (!open) setActive(false); }}
      onClick={() => {
        // Reaching for the destination answers the naming prompt anchored here
        // ("Not now"): two popovers on one control would hide the one asked for.
        if (identity?.firstUse) identity.completeFirstUse?.('skipped');
        setOpen((v) => !v);
      }}
    >
      <span className="media-destination-text">
        <span className="media-destination-prefix">Playing on</span>
        <span className="media-destination-name" data-testid="destination-control-name">{name}</span>
      </span>
      <IconChevronDown size={16} aria-hidden />
    </UnstyledButton>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withinPortal closeOnEscape={false}>
      <Popover.Target>{control}</Popover.Target>
      <Popover.Dropdown data-testid="cast-popover" className="cast-popover">
        <div className="cast-popover-section">
          <Text size="sm" c="dimmed" fw={600} mb={4}>When playing elsewhere</Text>
          <label className="cast-popover-row">
            <input
              type="radio"
              name="cast-mode"
              checked={mode === 'transfer'}
              onChange={() => setMode('transfer')}
              data-testid="cast-mode-transfer"
            />
            <span>Move playback to the device</span>
          </label>
          <label className="cast-popover-row">
            <input
              type="radio"
              name="cast-mode"
              checked={mode === 'fork'}
              onChange={() => setMode('fork')}
              data-testid="cast-mode-fork"
            />
            <span>Keep playing here too</span>
          </label>
        </div>
        <div className="cast-popover-section">
          <Text size="sm" c="dimmed" fw={600} mb={4}>Play on</Text>
          {devices.length === 0 && <Text size="sm" c="dimmed">No devices</Text>}
          {devices.map((d) => (
            <label key={d.id} className="cast-popover-row">
              <input
                type="checkbox"
                checked={targetIds.includes(d.id)}
                onChange={() => toggleTarget(d.id)}
                data-testid={`cast-target-checkbox-${d.id}`}
              />
              <span>{deviceName(d)}</span>
            </label>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

export default CastTargetChip;
