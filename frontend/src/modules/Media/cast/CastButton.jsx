// frontend/src/modules/Media/cast/CastButton.jsx
// Per-item Cast affordance on result/browse rows and the detail page.
// Placeholder until the cast phase wires the dispatch target picker; the
// button identity (testid) is already the real contract.
import React from 'react';
import { Button } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';

export function CastButton({ contentId, queue, onAction }) {
  const id = contentId ?? queue;
  return (
    <Button
      data-testid={`cast-button-${id}`}
      className="cast-button"
      size="compact-sm"
      variant="subtle"
      color="gray"
      leftSection={<IconCast size={16} />}
      disabled
      title="Casting arrives with the cast phase"
    >
      Cast
    </Button>
  );
}

export default CastButton;
