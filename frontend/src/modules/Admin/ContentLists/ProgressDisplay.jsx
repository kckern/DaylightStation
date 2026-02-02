import React from 'react';
import { Progress, Tooltip, Text, Group } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

/**
 * ProgressDisplay - Shows progress bar or watched checkmark for watchlist items
 *
 * Props:
 * - item: The list item object with optional progress (0-100) and watched (boolean) fields
 *
 * Display Logic:
 * 1. If watched: true - Show green checkmark icon
 * 2. Else if progress > 0 - Show progress bar with percentage
 * 3. Else - Show nothing (empty cell)
 */
function ProgressDisplay({ item }) {
  if (!item) return null;

  const { watched, progress } = item;

  // If watched, show green checkmark
  if (watched === true) {
    return (
      <Tooltip label="Progress tracked automatically via media_memory" withArrow position="top">
        <Group gap={4} wrap="nowrap">
          <IconCheck size={16} color="var(--mantine-color-green-6)" />
        </Group>
      </Tooltip>
    );
  }

  // If progress > 0, show progress bar with percentage
  if (progress > 0) {
    return (
      <Tooltip label="Progress tracked automatically via media_memory" withArrow position="top">
        <Group gap={6} wrap="nowrap">
          <Progress
            value={progress}
            size="xs"
            color="blue"
            style={{ width: 40 }}
          />
          <Text size="xs" c="dimmed">
            {Math.round(progress)}%
          </Text>
        </Group>
      </Tooltip>
    );
  }

  // No progress or watched state - show nothing
  return null;
}

export default ProgressDisplay;
