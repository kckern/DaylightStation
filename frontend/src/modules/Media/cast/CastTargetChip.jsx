// frontend/src/modules/Media/cast/CastTargetChip.jsx
// The dock's cast preferences: preferred target device(s) and the default
// Transfer/Fork mode, persisted per browser. Inline cast pickers seed from
// these so a configured household is one tap per cast.
import React, { useState, useCallback } from 'react';
import { Popover, ActionIcon, Indicator, Text } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import { useDismissLayer } from '../shell/DismissStackProvider.jsx';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';

export function CastTargetChip() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissLayer(open, close);
  const { mode, targetIds, setMode, toggleTarget } = useCastTarget();
  const { devices } = useFleetContext();

  const chip = (
    <ActionIcon
      data-testid="cast-target-chip"
      aria-label="Cast target"
      onClick={() => setOpen((v) => !v)}
    >
      <IconCast size={20} />
    </ActionIcon>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withinPortal closeOnEscape={false}>
      <Popover.Target>
        {targetIds.length > 0
          ? <Indicator color="amber" size={8} offset={4}>{chip}</Indicator>
          : chip}
      </Popover.Target>
      <Popover.Dropdown data-testid="cast-popover" className="cast-popover">
        <div className="cast-popover-section">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Mode</Text>
          <label className="cast-popover-row">
            <input
              type="radio"
              name="cast-mode"
              checked={mode === 'transfer'}
              onChange={() => setMode('transfer')}
              data-testid="cast-mode-transfer"
            />
            <span>Transfer (stop local)</span>
          </label>
          <label className="cast-popover-row">
            <input
              type="radio"
              name="cast-mode"
              checked={mode === 'fork'}
              onChange={() => setMode('fork')}
              data-testid="cast-mode-fork"
            />
            <span>Fork (keep local)</span>
          </label>
        </div>
        <div className="cast-popover-section">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>Preferred targets</Text>
          {devices.length === 0 && <Text size="sm" c="dimmed">No devices</Text>}
          {devices.map((d) => (
            <label key={d.id} className="cast-popover-row">
              <input
                type="checkbox"
                checked={targetIds.includes(d.id)}
                onChange={() => toggleTarget(d.id)}
                data-testid={`cast-target-checkbox-${d.id}`}
              />
              <span>{d.name ?? d.id}</span>
            </label>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

export default CastTargetChip;
