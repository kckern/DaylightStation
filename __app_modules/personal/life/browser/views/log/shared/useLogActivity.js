import { useMemo } from 'react';
import { useLifelog } from '../../../hooks/useLifelog.js';

/** Project the selected categories from the current member and date range's loaded log. */
export function useLogActivity({ categories, ...query }) {
  const { data, loading, error, refetch } = useLifelog(query);
  const activity = useMemo(() => {
    const days = data?.days ?? {};
    const summaries = data?.summaries ?? [];
    if (!categories?.length) return { days, summaries };

    const selected = new Set(categories);
    const visibleSummaries = entries => (entries ?? []).filter(entry => selected.has(entry.category));
    // Keep dates with zero matches so the heatmap and active-day denominator retain the selected period.
    const visibleDays = Object.fromEntries(Object.entries(days).map(([date, day]) => [date, {
      sources: Object.fromEntries(categories.flatMap(category => Object.entries(day.categories?.[category] ?? {}))),
      summaries: visibleSummaries(day.summaries),
    }]));
    return { days: visibleDays, summaries: visibleSummaries(summaries) };
  }, [data, categories]);

  return { ...activity, loading, error, refetch };
}
