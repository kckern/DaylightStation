// frontend/src/modules/Media/cast/CastTargetChip.jsx
// The dock's cast-target affordance. Until the cast phase wires real targets
// this opens an informational popover; the chip + popover Escape layering is
// already real (a layer must close without popping the view).
import React, { useState, useCallback } from 'react';
import { Popover, ActionIcon, Text } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import { useDismissLayer } from '../shell/DismissStackProvider.jsx';

export function CastTargetChip() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissLayer(open, close);

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withinPortal closeOnEscape={false}>
      <Popover.Target>
        <ActionIcon
          data-testid="cast-target-chip"
          aria-label="Cast target"
          onClick={() => setOpen((v) => !v)}
        >
          <IconCast size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown data-testid="cast-popover">
        <Text size="sm" c="dimmed">Cast targets arrive with the fleet phase.</Text>
      </Popover.Dropdown>
    </Popover>
  );
}

export default CastTargetChip;
