import { useMemo } from 'react';
import { Stack, Text, ScrollArea } from '@mantine/core';
import { startOfCalendarWeek } from '@/lib/calendarDay.js';
import { getHeatColor } from "./heatColor.js";

const CELL_SIZE = 12;
const GAP = 2;
const DAYS_IN_WEEK = 7;

/**
 * GitHub-style contribution heatmap.
 *
 * @param {Object} props
 * @param {Object} props.days - { 'YYYY-MM-DD': { sources: {}, ... } }
 * @param {Function} [props.countFn] - custom count per day, defaults to source count
 * @param {string} [props.startDate] - inclusive range start, when days are filtered
 * @param {string} [props.endDate] - inclusive range end, when days are filtered
 * @param {number} [props.weekStartsOn=0] - calendar week start, Sunday (0) through Saturday (6)
 */
export function ActivityHeatmap({ days = {}, countFn, startDate, endDate, weekStartsOn = 0 }) {
  const { cells, maxCount, weeks } = useMemo(() => {
    const dates = Object.keys(days).sort();
    const rangeStart = startDate || dates[0];
    const rangeEnd = endDate || dates[dates.length - 1];
    if (!rangeStart || !rangeEnd) return { cells: [], maxCount: 0, weeks: 0 };

    const counts = {};
    let max = 0;
    for (const [date, day] of Object.entries(days)) {
      const c = countFn ? countFn(day) : Object.keys(day.sources || {}).length;
      counts[date] = c;
      if (c > max) max = c;
    }

    const start = new Date(rangeStart);
    const end = new Date(rangeEnd);

    const alignedStart = new Date(startOfCalendarWeek(rangeStart, weekStartsOn));

    const result = [];
    let current = new Date(alignedStart);
    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      result.push({
        date: dateStr,
        count: counts[dateStr] || 0,
        inRange: current >= start && current <= end,
      });
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return { cells: result, maxCount: max, weeks: Math.ceil(result.length / 7) };
  }, [days, countFn, startDate, endDate, weekStartsOn]);

  if (cells.length === 0) {
    return <Text size="sm" c="dimmed">No activity data</Text>;
  }

  return (
    <Stack gap={4}>
      <ScrollArea type="auto" scrollbarSize={6}>
        <svg
          width={weeks * (CELL_SIZE + GAP) + GAP}
          height={DAYS_IN_WEEK * (CELL_SIZE + GAP) + GAP}
        >
          {cells.map((cell, i) => {
            const week = Math.floor(i / DAYS_IN_WEEK);
            const day = i % DAYS_IN_WEEK;
            if (!cell.inRange) return null;
            return (
              <rect
                key={cell.date}
                x={week * (CELL_SIZE + GAP) + GAP}
                y={day * (CELL_SIZE + GAP) + GAP}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                fill={getHeatColor(cell.count, maxCount)}
              >
                <title>{`${cell.date}: ${cell.count} sources`}</title>
              </rect>
            );
          })}
        </svg>
      </ScrollArea>
    </Stack>
  );
}
