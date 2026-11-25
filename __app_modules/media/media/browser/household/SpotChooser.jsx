// frontend/src/modules/Media/household/SpotChooser.jsx
// PLAY.4a/AC2: when screens hold different spots for one item, the person
// chooses — "1 h 20 m on Living Room TV · 12 m on Kid's tablet" — or starts
// from the beginning. A centred overlay (never page space); every choice is a
// full-size button reachable by keyboard and gamepad.
import React from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { IconPlayerPlayFilled, IconRotate } from '@tabler/icons-react';
import { FormDialog } from "@/lib/ui/FormDialog.jsx";
import { spotLine } from "./householdModel.js";
import { formatTime } from "../shell/formatTime.js";

export function SpotChooser({ choice, nameFor, onChoose, onClose }) {
  const open = Boolean(choice);
  const title = choice?.item?.title ?? 'this';
  return (
    <FormDialog opened={open} onClose={onClose}
      title={`Continue ${title} from…`}
      closeButtonProps={{ 'aria-label': 'Close resume position chooser' }}
      data-testid="spot-chooser" centered>
      {choice && <Stack gap="sm">
        {choice.spots.map((spot, index) => {
          return (
            <Button
              key={`${spot.deviceId ?? 'spot'}-${index}`}
              data-testid={`spot-choice-${index}`}
              variant={index === 0 ? 'filled' : 'default'}
              size="md"
              mih={44}
              justify="flex-start"
              leftSection={<IconPlayerPlayFilled size={16} aria-hidden />}
              onClick={() => onChoose(spot.playhead, spot)}
            >
              {spotLine(spot, nameFor, formatTime)}
            </Button>
          );
        })}
        <Button
          data-testid="spot-choice-beginning"
          variant="default"
          size="md"
          mih={44}
          justify="flex-start"
          leftSection={<IconRotate size={16} aria-hidden />}
          onClick={() => onChoose(0, null)}
        >
          From the beginning
        </Button>
        <Text size="xs" c="dimmed">Each screen keeps its own place.</Text>
      </Stack>}
    </FormDialog>
  );
}

export default SpotChooser;
