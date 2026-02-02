import React from 'react';
import { Group, Tooltip, Badge, ActionIcon } from '@mantine/core';
import {
  IconArrowsShuffle,
  IconRepeat,
  IconRepeatOnce,
  IconSortAscending,
  IconVolume,
  IconPlayerPlay,
  IconCalendar,
  IconClockPause,
  IconClockPlay,
  IconBrush,
  IconStack2
} from '@tabler/icons-react';
import { CONFIG_INDICATORS, MAX_CONFIG_ICONS, ITEM_DEFAULTS } from './listConstants.js';

// Map icon names to actual icon components
const ICON_MAP = {
  IconArrowsShuffle,
  IconRepeat,
  IconRepeatOnce,
  IconSortAscending,
  IconVolume,
  IconPlayerPlay,
  IconCalendar,
  IconClockPause,
  IconClockPlay,
  IconBrush,
  IconStack2
};

/**
 * Check if a config indicator is active for an item
 * @param {Object} indicator - The indicator definition from CONFIG_INDICATORS
 * @param {Object} item - The list item to check
 * @returns {boolean} - Whether the indicator should be shown
 */
function isIndicatorActive(indicator, item) {
  const value = item[indicator.field];
  const defaultValue = ITEM_DEFAULTS[indicator.field];

  // If indicator has a custom condition, use it
  if (indicator.condition) {
    return indicator.condition(value);
  }

  // Otherwise, check if value differs from default
  // For booleans, true is "active"
  if (typeof defaultValue === 'boolean') {
    return value === true;
  }

  // For other types, any non-default, non-null value is active
  return value !== defaultValue && value != null;
}

/**
 * ConfigIndicators - Shows icons for active config options on a list item
 *
 * Props:
 * - item: The list item object
 * - onClick: Optional click handler (opens editor in Full mode)
 *
 * Example:
 * - Item with shuffle=true, continuous=true, days="Weekend" shows: shuffle icon, repeat icon, +1
 * - Hover tooltip: "Shuffle, Continuous, Scheduled"
 */
function ConfigIndicators({ item, onClick }) {
  if (!item) return null;

  // Get all active indicators in priority order
  const activeIndicators = CONFIG_INDICATORS.filter(indicator =>
    isIndicatorActive(indicator, item)
  );

  // If no active indicators, return null
  if (activeIndicators.length === 0) {
    return null;
  }

  // Split into visible icons and overflow
  const visibleIndicators = activeIndicators.slice(0, MAX_CONFIG_ICONS);
  const overflowCount = activeIndicators.length - MAX_CONFIG_ICONS;

  // Build tooltip content showing all active config names
  const tooltipContent = activeIndicators.map(ind => ind.label).join(', ');

  return (
    <Tooltip label={tooltipContent} withArrow position="top">
      <Group
        gap={2}
        wrap="nowrap"
        style={{ cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
      >
        {visibleIndicators.map(indicator => {
          const IconComponent = ICON_MAP[indicator.icon];
          if (!IconComponent) return null;

          return (
            <ActionIcon
              key={indicator.field}
              size="xs"
              variant="subtle"
              color="dimmed"
              style={{ pointerEvents: 'none' }}
            >
              <IconComponent size={14} />
            </ActionIcon>
          );
        })}

        {overflowCount > 0 && (
          <Badge
            size="xs"
            variant="light"
            color="gray"
            radius="sm"
            style={{ minWidth: 'auto', padding: '0 4px' }}
          >
            +{overflowCount}
          </Badge>
        )}
      </Group>
    </Tooltip>
  );
}

export default ConfigIndicators;
