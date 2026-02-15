import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';

/**
 * Hook that fetches and combines agent dashboard data with live health API data.
 * Polls every 5 minutes and cleans up on unmount.
 *
 * @param {string} userId - The user to fetch dashboard data for
 * @returns {{ loading: boolean, error: string|null, dashboard: object|null, liveData: object|null, refetch: Function }}
 */
export function useDashboardData(userId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch agent dashboard and live health APIs in parallel.
      // Using Promise.allSettled so a 404 on dashboard (agent hasn't run)
      // doesn't block live data from loading.
      const [dashboardRes, weightRes, nutritionRes, healthRes] = await Promise.allSettled([
        DaylightAPI(`/api/v1/health-dashboard/${userId}`),
        DaylightAPI('/api/v1/health/weight'),
        DaylightAPI('/api/v1/health/nutrilist'),
        // days is a query param — pass it in the URL to avoid DaylightAPI
        // auto-converting to POST when data object is provided.
        DaylightAPI('/api/v1/health/daily?days=7'),
      ]);

      if (!mountedRef.current) return;

      const agentDashboard = dashboardRes.status === 'fulfilled' && dashboardRes.value?.dashboard
        ? dashboardRes.value.dashboard
        : null;

      const weightData = weightRes.status === 'fulfilled' ? weightRes.value : null;
      const weight = parseWeightData(weightData);

      const nutritionData = nutritionRes.status === 'fulfilled' ? nutritionRes.value : null;
      const nutrition = parseNutritionData(nutritionData);

      const healthData = healthRes.status === 'fulfilled' ? healthRes.value?.data : null;
      const workouts = parseWorkoutData(healthData);

      setDashboard(agentDashboard);
      setLiveData({ weight, nutrition, workouts });
    } catch (err) {
      if (mountedRef.current) setError(err.message || 'Failed to load dashboard');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  return { loading, error, dashboard, liveData, refetch: fetchData };
}

/**
 * Parse raw weight API response into a structured summary.
 * Expects an object keyed by date string with weight metrics.
 */
function parseWeightData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const dates = Object.keys(raw).sort().reverse();
  if (!dates.length) return null;

  const latest = raw[dates[0]];
  const weekAgo = raw[dates[Math.min(dates.length - 1, 6)]];

  return {
    current: latest.lbs_adjusted_average || latest.lbs,
    fatPercent: latest.fat_percent_average || latest.fat_percent,
    trend7d: latest.lbs_adjusted_average_7day_trend || null,
    date: latest.date,
    weekAgo: weekAgo?.lbs_adjusted_average || weekAgo?.lbs || null,
    history: dates.slice(0, 7).map(d => ({
      date: d,
      lbs: raw[d].lbs_adjusted_average || raw[d].lbs,
    })),
  };
}

/**
 * Parse raw nutrition API response into daily totals.
 * Expects { data: [...items] } or a bare array.
 */
function parseNutritionData(raw) {
  if (!raw) return null;
  const items = raw.data || raw;
  if (!Array.isArray(items)) return null;

  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, count: items.length };
  for (const item of items) {
    totals.calories += item.calories || 0;
    totals.protein += item.protein || 0;
    totals.carbs += item.carbs || 0;
    totals.fat += item.fat || 0;
  }
  return { ...totals, logged: items.length > 0 };
}

/**
 * Parse raw daily health data into a sorted list of recent workouts.
 * Expects an object keyed by date with { workouts: [...] } arrays.
 */
function parseWorkoutData(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const workouts = [];
  for (const [date, metric] of Object.entries(raw)) {
    for (const w of (metric?.workouts || [])) {
      workouts.push({
        date,
        title: w.title || w.type || 'Workout',
        type: w.type,
        duration: w.duration,
        calories: w.calories || w.total_workout_calories,
        avgHr: w.avgHr,
      });
    }
  }
  return workouts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
}

/**
 * Split a compound content ID (e.g. "plex:12345") into source and localId.
 * Defaults source to 'plex' if no colon is present.
 *
 * Note: trim localId after split — YAML values with colons can include
 * trailing whitespace (see MEMORY.md re: YAML whitespace in content IDs).
 *
 * @param {string} contentId
 * @returns {{ source: string, localId: string }}
 */
export function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: contentId };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return {
    source: contentId.slice(0, colonIdx).trim(),
    localId: contentId.slice(colonIdx + 1).trim(),
  };
}
