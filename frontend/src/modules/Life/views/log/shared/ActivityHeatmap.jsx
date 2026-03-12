import { useMemo } from 'react';
import { Stack, Text, Group, Tooltip, Box } from '@mantine/core';

const CELL_SIZE = 12;
const GAP = 2;
const DAYS_IN_WEEK = 7;

function getColor(count, max) {
  if (count === 0) return 'var(--mantine-color-dark-6)';
  const ratio = count / max;
  if (ratio > 0.75) return 'var(--mantine-color-green-6)';
  if (ratio > 0.5) return 'var(--mantine-color-green-5)';
  if (ratio > 0.25) return 'var(--mantine-color-green-4)';
  return 'var(--mantine-color-green-3)';
}

/**
 * GitHub-style contribution heatmap.
 *
 * @param {Object} props
 * @param {Object} props.days - { 'YYYY-MM-DD': { sources: {}, ... } }
 * @param {Function} [props.countFn] - custom count per day, defaults to source count
 */
export function ActivityHeatmap({ days = {}, countFn }) {
  const { cells, maxCount, weeks } = useMemo(() => {
    const dates = Object.keys(days).sort();
    if (dates.length === 0) return { cells: [], maxCount: 0, weeks: 0 };

    const counts = {};
    let max = 0;
    for (const [date, day] of Object.entries(days)) {
      const c = countFn ? countFn(day) : Object.keys(day.sources || {}).length;
      counts[date] = c;
      if (c > max) max = c;
    }

    const startDate = new Date(dates[0]);
    const endDate = new Date(dates[dates.length - 1]);

    // Align to start of week (Sunday)
    const alignedStart = new Date(startDate);
    alignedStart.setDate(alignedStart.getDate() - alignedStart.getDay());

    const result = [];
    let current = new Date(alignedStart);
    while (current <= endDate) {
      const dateStr = current.toISOString().slice(0, 10);
      result.push({
        date: dateStr,
        count: counts[dateStr] || 0,
        inRange: current >= startDate && current <= endDate,
      });
      current.setDate(current.getDate() + 1);
    }

    return { cells: result, maxCount: max, weeks: Math.ceil(result.length / 7) };
  }, [days, countFn]);

  if (cells.length === 0) {
    return <Text size="sm" c="dimmed">No activity data</Text>;
  }

  return (
    <Stack gap={4}>
      <svg
        width={weeks * (CELL_SIZE + GAP) + GAP}
        height={DAYS_IN_WEEK * (CELL_SIZE + GAP) + GAP}
      >
        {cells.map((cell, i) => {
          const week = Math.floor(i / DAYS_IN_WEEK);
          const day = i % DAYS_IN_WEEK;
          if (!cell.inRange) return null;

          return (
            <Tooltip key={cell.date} label={`${cell.date}: ${cell.count} sources`}>
              <rect
                x={week * (CELL_SIZE + GAP) + GAP}
                y={day * (CELL_SIZE + GAP) + GAP}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                fill={getColor(cell.count, maxCount)}
              />
            </Tooltip>
          );
        })}
      </svg>
    </Stack>
  );
}
