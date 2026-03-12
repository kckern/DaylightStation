import { useState, useMemo } from 'react';
import { Stack, Paper } from '@mantine/core';
import { ScopeSelector } from './shared/ScopeSelector.jsx';
import { CategoryFilter } from './shared/CategoryFilter.jsx';
import { LogDayDetail } from './LogDayDetail.jsx';
import { LogWeekView } from './LogWeekView.jsx';
import { LogMonthView } from './LogMonthView.jsx';

/**
 * Main log browser with scope switching and category filtering.
 * Renders the appropriate view based on the selected scope.
 */
export function LogBrowser({ username }) {
  const [scope, setScope] = useState('week');
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [categories, setCategories] = useState([]);

  const viewProps = useMemo(() => ({
    username,
    categories: categories.length > 0 ? categories : undefined,
  }), [username, categories]);

  return (
    <Stack gap="md">
      <Paper p="sm" withBorder>
        <Stack gap="sm">
          <ScopeSelector value={scope} onChange={setScope} />
          <CategoryFilter selected={categories} onChange={setCategories} />
        </Stack>
      </Paper>

      {scope === 'day' && (
        <LogDayDetail date={selectedDate} {...viewProps} />
      )}
      {scope === 'week' && (
        <LogWeekView {...viewProps} />
      )}
      {scope === 'month' && (
        <LogMonthView {...viewProps} />
      )}
    </Stack>
  );
}
