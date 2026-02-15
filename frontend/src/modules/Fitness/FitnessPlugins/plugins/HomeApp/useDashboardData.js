import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';

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
      const [dashboardRes, weightRes, healthRes, sessionsRes] = await Promise.allSettled([
        DaylightAPI(`/api/v1/health-dashboard/${userId}`),
        DaylightAPI('/api/v1/health/weight'),
        DaylightAPI('/api/v1/health/daily?days=10'),
        fetchRecentSessions(5),
      ]);

      if (!mountedRef.current) return;

      const agentDashboard = dashboardRes.status === 'fulfilled' && dashboardRes.value?.dashboard
        ? dashboardRes.value.dashboard
        : null;

      const weightData = weightRes.status === 'fulfilled' ? weightRes.value : null;
      const weight = parseWeightData(weightData);

      const healthData = healthRes.status === 'fulfilled' ? healthRes.value?.data : null;
      const nutritionHistory = parseNutritionHistory(healthData);
      const workouts = parseWorkoutData(healthData);

      const sessions = sessionsRes.status === 'fulfilled' ? sessionsRes.value : [];

      setDashboard(agentDashboard);
      setLiveData({ weight, nutrition: nutritionHistory, workouts, sessions });
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
 * Parse daily health data into a 10-day nutrition history.
 * Returns an array sorted newest-first with per-day totals.
 */
function parseNutritionHistory(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .filter(([, v]) => v?.nutrition)
    .map(([date, v]) => ({
      date,
      calories: v.nutrition.calories || 0,
      protein: v.nutrition.protein || 0,
      carbs: v.nutrition.carbs || 0,
      fat: v.nutrition.fat || 0,
      foodCount: v.nutrition.foodCount || 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetch recent fitness sessions with media info.
 * Gets session dates, then fetches session details to extract content played.
 */
async function fetchRecentSessions(limit = 10) {
  const datesRes = await DaylightAPI('/api/v1/fitness/sessions/dates');
  const dates = (Array.isArray(datesRes) ? datesRes : datesRes?.dates || [])
    .sort((a, b) => b.localeCompare(a));

  const sessions = [];
  for (const date of dates) {
    if (sessions.length >= limit) break;
    const dayRes = await DaylightAPI(`/api/v1/fitness/sessions?date=${date}`);
    const daySessions = Array.isArray(dayRes) ? dayRes : dayRes?.sessions || [];
    for (const s of daySessions) {
      if (sessions.length >= limit) break;
      const detail = await DaylightAPI(`/api/v1/fitness/sessions/${s.sessionId}`);
      const session = detail?.session || detail;
      const events = session?.timeline?.events || [];
      const media = events.find(e => e.type === 'media');
      if (!media) continue; // Skip sessions without content
      const participants = Object.entries(session?.participants || {}).map(([id, info]) => ({
        id,
        displayName: info.display_name || id,
      }));
      const totalCoins = session?.treasureBox?.totalCoins || 0;
      sessions.push({
        sessionId: s.sessionId,
        date: session?.session?.date || date,
        durationMs: s.durationMs,
        participants,
        totalCoins,
        media: {
          mediaId: media.data?.mediaId,
          title: media.data?.title,
          showTitle: media.data?.grandparentTitle,
          seasonTitle: media.data?.parentTitle,
          grandparentId: media.data?.grandparentId || null,
          parentId: media.data?.parentId || null,
        },
      });
    }
  }
  return sessions;
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
