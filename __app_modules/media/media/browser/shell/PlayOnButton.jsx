// shell/PlayOnButton.jsx
// Now Playing's one "Play on…" (ruling 2026-11-27): the existing picker (the
// screens this browser uses most first, More for the rest, each with its
// state), opened from one button instead of an inline device list. Moving
// (Stop it here) and several screens at once are inside the picker. The
// source is this device's session, so a pick hands it off (useHandOff).
import React, { useState } from 'react';
import { Button } from '@mantine/core';
import { IconCast } from '@tabler/icons-react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { DispatchTargetPicker } from "../cast/DispatchTargetPicker.jsx";
import { pickerHeading } from "../actions/ItemDestinationPicker.jsx";
import mediaLog from "../logging/mediaLog.js";

export function PlayOnButton({ getSnapshot, title = null }) {
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
    mediaLog.nowPlayingPlayOnOpened({ hasTitle: Boolean(title) });
  };
  return (
    <>
      <Button
        data-testid="np-play-on"
        className="np-play-on"
        variant="default"
        size="sm"
        radius="xl"
        leftSection={<IconCast size={16} aria-hidden />}
        aria-label="Play on…"
        title="Play on…"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
      >
        Play on…
      </Button>
      <FormDialog opened={open} onClose={() => setOpen(false)} title={pickerHeading('Play', title)}>
        {open && (
          <div data-testid="handoff-section">
            <DispatchTargetPicker
              source={{ getSnapshot, title }}
              verb="Play"
              autoFocus
              onComplete={() => setOpen(false)}
            />
          </div>
        )}
      </FormDialog>
    </>
  );
}

export default PlayOnButton;
