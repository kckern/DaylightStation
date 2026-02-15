# Fitness Dashboard Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the placeholder HomeApp fitness plugin with a widget-based health dashboard that displays live health data (weight, nutrition, workouts) and agent-curated content (workout recommendations, coaching messages).

**Architecture:** The HomeApp plugin (`frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/`) becomes the dashboard. A `useDashboardData` hook fetches from two sources: the agent-generated dashboard API (`/api/v1/health-dashboard/:userId`) for curated/coach content, and live health APIs (`/api/v1/health/*`) for real-time state widgets. Widget components render in a Mantine Grid layout optimized for a large touchscreen TV (kiosk mode). When the agent hasn't run yet, the dashboard gracefully degrades to showing only live data widgets.

**Tech Stack:** React (functional components + hooks), Mantine v7 UI, DaylightAPI (existing fetch helper), SCSS, FitnessContext (play queue access)

**Design spec:** `docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md` — Dashboard Design section + Stress Test #4 (staleness), #7 (phase ordering)

**Backend (already built):** Agent framework, HealthCoachAgent, DailyDashboard assignment, dashboard API endpoint (`/api/v1/health-dashboard/:userId/:date`)

---

### Task 1: Create useDashboardData hook

Data fetching hook that combines agent dashboard + live health APIs into a single data object for the dashboard.

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js`

**Step 1: Write the hook**

```javascript
// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js

import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../../../lib/api.mjs';

/**
 * useDashboardData - Fetches agent dashboard + live health data.
 *
 * Two data sources:
 * 1. Agent dashboard (GET /api/v1/health-dashboard/:userId) — curated content + coach voice
 * 2. Live health APIs — weight, nutrition, workouts (always fresh, supplements agent data)
 *
 * Returns { loading, error, dashboard, liveData, refetch }
 *
 * @param {string} userId - User identifier for API calls
 */
export function useDashboardData(userId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null); // Agent-generated content
  const [liveData, setLiveData] = useState(null);   // Real-time health data
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch agent dashboard + live data in parallel
      const [dashboardRes, weightRes, nutritionRes, healthRes] = await Promise.allSettled([
        DaylightAPI(`/api/v1/health-dashboard/${userId}`),
        DaylightAPI('/api/v1/health/weight'),
        DaylightAPI('/api/v1/health/nutrilist'),
        DaylightAPI('/api/v1/health/daily', { days: 7 }),
      ]);

      if (!mountedRef.current) return;

      // Agent dashboard — may 404 if agent hasn't run (that's OK)
      const agentDashboard = dashboardRes.status === 'fulfilled' && dashboardRes.value?.dashboard
        ? dashboardRes.value.dashboard
        : null;

      // Live weight data
      const weightData = weightRes.status === 'fulfilled' ? weightRes.value : null;
      const weight = parseWeightData(weightData);

      // Live nutrition data
      const nutritionData = nutritionRes.status === 'fulfilled' ? nutritionRes.value : null;
      const nutrition = parseNutritionData(nutritionData);

      // Live workout/health data
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
    // Refresh live data every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  return { loading, error, dashboard, liveData, refetch: fetchData };
}

// --- Data parsing helpers ---

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
 * Parse a content_id like "plex:12345" into source + localId.
 * Used by UpNextCard to construct playback URLs.
 */
export function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: contentId };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return {
    source: contentId.slice(0, colonIdx),
    localId: contentId.slice(colonIdx + 1),
  };
}
```

**Step 2: Verify it imports correctly**

Add a temporary `console.log('hook loaded')` at the top, import it in HomeApp.jsx, and check the browser console. Remove after verification.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/useDashboardData.js
git commit -m "feat(dashboard): add useDashboardData hook for health dashboard data fetching"
```

---

### Task 2: Create DashboardWidgets.jsx — state widgets

Three live-data cards: WeightTrendCard, NutritionCard, WorkoutsCard. Plus a shared DashboardCard wrapper.

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx`

**Step 1: Write all state widget components**

```jsx
// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx

import React from 'react';
import { Paper, Text, Title, Group, Stack, Badge, Progress } from '@mantine/core';

// ─── Shared card wrapper ───────────────────────────────────────

export function DashboardCard({ title, icon, children, className = '', onClick }) {
  return (
    <Paper
      className={`dashboard-card ${className}`}
      p="md"
      radius="md"
      onPointerDown={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e); } : undefined}
    >
      {title && (
        <Group gap="xs" mb="sm">
          {icon && <Text size="lg">{icon}</Text>}
          <Text size="sm" fw={600} tt="uppercase" c="dimmed">{title}</Text>
        </Group>
      )}
      {children}
    </Paper>
  );
}

// ─── Weight Trend Card ─────────────────────────────────────────

export function WeightTrendCard({ weight }) {
  if (!weight) {
    return (
      <DashboardCard title="Weight" icon={null} className="dashboard-card--weight">
        <Text c="dimmed" ta="center" py="md">No weight data</Text>
      </DashboardCard>
    );
  }

  const trendArrow = weight.trend7d < 0 ? '\u2193' : weight.trend7d > 0 ? '\u2191' : '\u2192';
  const trendColor = weight.trend7d < 0 ? 'green' : weight.trend7d > 0 ? 'red' : 'gray';

  return (
    <DashboardCard title="Weight" className="dashboard-card--weight">
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {weight.current.toFixed(1)}
        </Title>
        <Text size="sm" c="dimmed">lbs</Text>
        {weight.trend7d != null && (
          <Badge color={trendColor} variant="light" size="lg">
            {trendArrow} {Math.abs(weight.trend7d).toFixed(1)} lbs / 7d
          </Badge>
        )}
        {weight.fatPercent != null && (
          <Text size="xs" c="dimmed">{weight.fatPercent.toFixed(1)}% body fat</Text>
        )}
      </Stack>
    </DashboardCard>
  );
}

// ─── Nutrition Card ────────────────────────────────────────────

export function NutritionCard({ nutrition, goals }) {
  if (!nutrition || !nutrition.logged) {
    return (
      <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
        <Text c="dimmed" ta="center" py="md">No meals logged today</Text>
      </DashboardCard>
    );
  }

  const calTarget = goals?.nutrition?.daily_calories || 2200;
  const calPercent = Math.min(100, Math.round((nutrition.calories / calTarget) * 100));

  return (
    <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={3} className="dashboard-stat-value">{nutrition.calories}</Title>
          <Text size="sm" c="dimmed">/ {calTarget} cal</Text>
        </Group>
        <Progress value={calPercent} color={calPercent > 100 ? 'red' : 'blue'} size="sm" />
        <Group justify="space-between" mt="xs">
          <MacroLabel label="Protein" value={nutrition.protein} unit="g" />
          <MacroLabel label="Carbs" value={nutrition.carbs} unit="g" />
          <MacroLabel label="Fat" value={nutrition.fat} unit="g" />
        </Group>
      </Stack>
    </DashboardCard>
  );
}

function MacroLabel({ label, value, unit }) {
  return (
    <Stack gap={0} align="center">
      <Text size="lg" fw={600}>{Math.round(value)}</Text>
      <Text size="xs" c="dimmed">{label} ({unit})</Text>
    </Stack>
  );
}

// ─── Recent Workouts Card ──────────────────────────────────────

export function WorkoutsCard({ workouts }) {
  if (!workouts || workouts.length === 0) {
    return (
      <DashboardCard title="Recent Workouts" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent workouts</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Recent Workouts" className="dashboard-card--workouts">
      <Stack gap="xs">
        {workouts.slice(0, 4).map((w, i) => (
          <Group key={i} justify="space-between" className="workout-row">
            <div>
              <Text size="sm" fw={500}>{w.title}</Text>
              <Text size="xs" c="dimmed">{formatDate(w.date)}</Text>
            </div>
            <Group gap="xs">
              {w.duration && <Badge variant="light" size="sm">{w.duration} min</Badge>}
              {w.calories && <Badge variant="light" color="orange" size="sm">{w.calories} cal</Badge>}
            </Group>
          </Group>
        ))}
      </Stack>
    </DashboardCard>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const diff = Math.floor((today - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
```

**Step 2: Verify exports are importable**

```bash
# Quick syntax check — run from project root
node -e "import('./frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx')" 2>&1 || echo "JSX file, will be verified in browser"
```

JSX files need the Vite build pipeline. Verification will happen in Task 9 when we assemble the layout and view in browser.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "feat(dashboard): add state widget components (Weight, Nutrition, Workouts)"
```

---

### Task 3: Create UpNextCard — curated workout recommendation

The "invisible elf" widget. Shows the agent's recommended workout with thumbnail, title, duration, and a play button. Does NOT feel like an agent-generated recommendation — it feels like a native app feature.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx` (append)

**Step 1: Add UpNextCard and AlternatesRow to DashboardWidgets.jsx**

Append after the existing components:

```jsx
// ─── Up Next Card (curated content - "invisible elf") ──────────

export function UpNextCard({ curated, onPlay }) {
  if (!curated?.up_next?.primary) return null;

  const { primary, alternates } = curated.up_next;

  return (
    <DashboardCard className="dashboard-card--upnext">
      <Group gap="md" wrap="nowrap" align="flex-start">
        <ContentThumbnail contentId={primary.content_id} title={primary.title} />
        <Stack gap="xs" style={{ flex: 1 }}>
          {primary.program_context && (
            <Text size="xs" c="dimmed" tt="uppercase">{primary.program_context}</Text>
          )}
          <Title order={3}>{primary.title}</Title>
          <Group gap="xs">
            <Badge variant="light">{primary.duration} min</Badge>
          </Group>
          <div
            className="dashboard-play-btn"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => { e.stopPropagation(); onPlay?.(primary); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(primary); }}
          >
            <Text fw={700} size="lg">Play</Text>
          </div>
        </Stack>
      </Group>
      {alternates?.length > 0 && (
        <div className="upnext-alternates">
          <Text size="xs" c="dimmed" mt="md" mb="xs">Or try:</Text>
          <Group gap="xs">
            {alternates.map((alt, i) => (
              <Paper
                key={i}
                className="alternate-chip"
                p="xs"
                radius="sm"
                onPointerDown={() => onPlay?.(alt)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay?.(alt); }}
                role="button"
                tabIndex={0}
              >
                <Text size="sm">{alt.title}</Text>
                <Text size="xs" c="dimmed">{alt.duration} min</Text>
              </Paper>
            ))}
          </Group>
        </div>
      )}
    </DashboardCard>
  );
}

function ContentThumbnail({ contentId, title }) {
  const { source, localId } = parseContentIdInline(contentId);
  const thumbUrl = `/api/v1/display/${source}/${localId}`;

  return (
    <div className="content-thumbnail">
      <img
        src={thumbUrl}
        alt=""
        onError={(e) => { e.target.style.display = 'none'; }}
      />
    </div>
  );
}

function parseContentIdInline(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx), localId: contentId.slice(colonIdx + 1) };
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "feat(dashboard): add UpNextCard curated content widget"
```

---

### Task 4: Create CoachCard — coach presence

The "talking to Santa" widget. Explicitly in the agent's voice. Shows briefing, CTAs, and prompts.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx` (append)

**Step 1: Add CoachCard to DashboardWidgets.jsx**

Append after UpNextCard:

```jsx
// ─── Coach Card ("talking to Santa") ───────────────────────────

export function CoachCard({ coach, liveNutrition, onCtaAction }) {
  if (!coach) return null;

  // Filter stale CTAs by checking live data
  const activeCtas = (coach.cta || []).filter(cta => {
    // If CTA says "no meals logged" but live data shows meals, suppress it
    if (cta.type === 'data_gap' && cta.action === 'open_nutrition' && liveNutrition?.logged) {
      return false;
    }
    return true;
  });

  return (
    <DashboardCard className="dashboard-card--coach">
      {coach.briefing && (
        <div className="coach-briefing">
          <Text size="md" lh={1.5}>{coach.briefing}</Text>
        </div>
      )}

      {activeCtas.length > 0 && (
        <Stack gap="xs" mt="md">
          {activeCtas.map((cta, i) => (
            <Paper
              key={i}
              className={`coach-cta coach-cta--${cta.type}`}
              p="sm"
              radius="sm"
              onPointerDown={() => onCtaAction?.(cta)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCtaAction?.(cta); }}
              role={cta.action ? 'button' : undefined}
              tabIndex={cta.action ? 0 : undefined}
            >
              <Group gap="xs" wrap="nowrap">
                <Text size="sm">{ctaIcon(cta.type)}</Text>
                <Text size="sm">{cta.message}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {coach.prompts?.length > 0 && (
        <Stack gap="xs" mt="md">
          {coach.prompts.map((prompt, i) => (
            <div key={i} className="coach-prompt">
              <Text size="sm" fw={500} mb="xs">{prompt.question}</Text>
              {prompt.type === 'multiple_choice' && prompt.options && (
                <Group gap="xs">
                  {prompt.options.map((opt, j) => (
                    <Paper
                      key={j}
                      className="prompt-option"
                      p="xs"
                      radius="sm"
                      role="button"
                      tabIndex={0}
                      onPointerDown={() => {/* Phase 5: interactive coaching */}}
                    >
                      <Text size="sm">{opt}</Text>
                    </Paper>
                  ))}
                </Group>
              )}
            </div>
          ))}
        </Stack>
      )}
    </DashboardCard>
  );
}

function ctaIcon(type) {
  switch (type) {
    case 'data_gap': return '\u26A0';    // warning sign
    case 'observation': return '\uD83D\uDCC8'; // chart increasing
    case 'nudge': return '\u27A1';       // right arrow
    default: return '\u2022';            // bullet
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "feat(dashboard): add CoachCard with briefing, CTAs, and prompt widgets"
```

---

### Task 5: Create HomeApp.scss

Kiosk-optimized dark theme styles for all dashboard components. Designed for large touchscreen TVs — big touch targets, no hover-dependent interactions, high contrast on dark background.

**Files:**
- Create: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss`

**Step 1: Write the styles**

```scss
// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss

.health-dashboard {
  height: 100%;
  width: 100%;
  padding: 1rem;
  overflow-y: auto;
  overflow-x: hidden;

  // Scrollbar styling for kiosk
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
}

// ─── Dashboard Card Base ───────────────────────────────────────

.dashboard-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: background 0.15s ease;
  height: 100%;

  &[role="button"] {
    cursor: pointer;
    &:active { background: rgba(255, 255, 255, 0.1); }
  }
}

// ─── State Widget Cards ────────────────────────────────────────

.dashboard-stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  line-height: 1;
  color: white;
}

.workout-row {
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  &:last-child { border-bottom: none; }
}

// ─── Up Next Card (curated) ────────────────────────────────────

.dashboard-card--upnext {
  background: rgba(34, 139, 230, 0.08);
  border-color: rgba(34, 139, 230, 0.2);
}

.content-thumbnail {
  width: 160px;
  min-width: 160px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.dashboard-play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 2rem;
  background: #228be6;
  border-radius: 8px;
  cursor: pointer;
  min-height: 48px;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  &:active {
    background: #1c7ed6;
    transform: scale(0.97);
  }
}

.alternate-chip {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  user-select: none;

  &:active { background: rgba(255, 255, 255, 0.12); }
}

// ─── Coach Card ────────────────────────────────────────────────

.dashboard-card--coach {
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid rgba(34, 139, 230, 0.5);
}

.coach-briefing {
  font-style: italic;
  opacity: 0.9;
}

.coach-cta {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 48px;
  display: flex;
  align-items: center;

  &--data_gap { border-left: 3px solid #fab005; }
  &--observation { border-left: 3px solid #40c057; }
  &--nudge { border-left: 3px solid #228be6; }

  &[role="button"] {
    cursor: pointer;
    &:active { background: rgba(255, 255, 255, 0.1); }
  }
}

.coach-prompt {
  padding: 0.5rem 0;
}

.prompt-option {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  min-height: 48px;
  display: flex;
  align-items: center;
  user-select: none;

  &:active { background: rgba(255, 255, 255, 0.12); }
}

// ─── Empty State ───────────────────────────────────────────────

.dashboard-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  opacity: 0.6;
}

// ─── Loading State ─────────────────────────────────────────────

.dashboard-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss
git commit -m "feat(dashboard): add HomeApp.scss with kiosk-optimized dark theme styles"
```

---

### Task 6: Assemble HomeApp dashboard layout

Replace the placeholder HomeApp component with the full dashboard layout. Uses Mantine Grid to arrange widgets. Wires up the play interaction (tap Up Next → add to fitness play queue).

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx`

**Step 1: Read the current HomeApp.jsx**

Read: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx`

**Step 2: Replace the entire contents**

```jsx
// frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx

import React, { useMemo } from 'react';
import { Grid, Text, Loader } from '@mantine/core';
import { useDashboardData, parseContentId } from './useDashboardData.js';
import {
  WeightTrendCard,
  NutritionCard,
  WorkoutsCard,
  UpNextCard,
  CoachCard,
} from './DashboardWidgets.jsx';
import { useFitnessContext } from '../../../../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../../../../lib/api.mjs';
import './HomeApp.scss';

const HomeApp = () => {
  const fitnessCtx = useFitnessContext();

  // Determine userId from fitness config (head of household)
  const userId = useMemo(() => {
    const users = fitnessCtx?.fitnessConfiguration?.fitness?.users;
    const primary = users?.primary;
    if (Array.isArray(primary) && primary.length > 0) {
      return primary[0].name || primary[0].username || primary[0].id;
    }
    return null;
  }, [fitnessCtx?.fitnessConfiguration]);

  const contentSource = useMemo(() => {
    const root = fitnessCtx?.fitnessConfiguration?.fitness || fitnessCtx?.fitnessConfiguration || {};
    return root?.content_source || 'plex';
  }, [fitnessCtx?.fitnessConfiguration]);

  const { loading, error, dashboard, liveData, refetch } = useDashboardData(userId);

  // Goals from agent dashboard (if available)
  const goals = dashboard?.goals || null;

  // Play handler — adds content to fitness play queue
  const handlePlay = (contentItem) => {
    if (!contentItem?.content_id) return;
    const { source, localId } = parseContentId(contentItem.content_id);
    const queueItem = {
      id: localId,
      contentSource: source,
      type: 'episode',
      title: contentItem.title,
      videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
      image: DaylightMediaPath(`api/v1/display/${source}/${localId}`),
      duration: contentItem.duration,
    };
    fitnessCtx?.setFitnessPlayQueue?.(prev => [...prev, queueItem]);
  };

  // CTA action handler
  const handleCtaAction = (cta) => {
    // Future: navigate to specific views based on cta.action
    // For now, log and ignore
    console.log('CTA action:', cta.action, cta.message);
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <Loader color="blue" size="lg" />
      </div>
    );
  }

  if (error && !liveData) {
    return (
      <div className="dashboard-empty">
        <Text size="lg" c="red">{error}</Text>
        <Text
          size="sm"
          c="dimmed"
          mt="sm"
          style={{ cursor: 'pointer' }}
          onPointerDown={refetch}
        >
          Tap to retry
        </Text>
      </div>
    );
  }

  return (
    <div className="health-dashboard">
      <Grid gutter="md">
        {/* Row 1: Up Next (large) + Coach Card */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          {dashboard?.curated ? (
            <UpNextCard curated={dashboard.curated} onPlay={handlePlay} />
          ) : (
            <div className="dashboard-empty">
              <Text c="dimmed">No workout recommendations yet</Text>
            </div>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          {dashboard?.coach ? (
            <CoachCard
              coach={dashboard.coach}
              liveNutrition={liveData?.nutrition}
              onCtaAction={handleCtaAction}
            />
          ) : (
            <div className="dashboard-empty">
              <Text c="dimmed">Coach insights will appear here</Text>
            </div>
          )}
        </Grid.Col>

        {/* Row 2: State widgets */}
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <WeightTrendCard weight={liveData?.weight} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <NutritionCard nutrition={liveData?.nutrition} goals={goals} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 4 }}>
          <WorkoutsCard workouts={liveData?.workouts} />
        </Grid.Col>
      </Grid>
    </div>
  );
};

export default HomeApp;
```

**Step 3: Verify the import path for FitnessContext**

Check that `useFitnessContext` is importable from the HomeApp location. The import `../../../../../context/FitnessContext.jsx` resolves to `frontend/src/context/FitnessContext.jsx`. Verify this path exists:

Run: `ls frontend/src/context/FitnessContext.jsx`

Expected: File exists

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx
git commit -m "feat(dashboard): replace HomeApp placeholder with health dashboard layout"
```

---

### Task 7: Verify FitnessContext exposes setFitnessPlayQueue

The play interaction relies on `fitnessCtx.setFitnessPlayQueue`. Verify this is exposed by the context.

**Files:**
- Read: `frontend/src/context/FitnessContext.jsx`

**Step 1: Read FitnessContext and verify setFitnessPlayQueue is in the context value**

Read `frontend/src/context/FitnessContext.jsx` and search for `setFitnessPlayQueue` in the provider value object. If it's not exposed, add it.

Expected: The `FitnessProvider` receives `setFitnessPlayQueue` as a prop from `FitnessApp.jsx` (line 958) and should include it in its context value.

**Step 2: If not exposed, add it to the context value**

In `FitnessContext.jsx`, find the context value object and add `setFitnessPlayQueue` if missing.

**Step 3: Verify the content source config is accessible**

The dashboard needs `fitnessConfiguration.fitness.users.primary` to get the userId. Verify this path in the context — look at how `fitnessConfiguration` flows from `FitnessApp.jsx` into `FitnessProvider`.

**Step 4: Commit if changes were made**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix(dashboard): expose setFitnessPlayQueue in FitnessContext"
```

---

### Task 8: Update HomeApp manifest

The manifest needs to declare correct modes and requirements for the dashboard plugin.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/manifest.js`

**Step 1: Read current manifest**

Read: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/manifest.js`

**Step 2: Update the manifest**

Ensure it has:
```javascript
export default {
  id: 'home',
  name: 'Home',
  version: '1.0.0',
  icon: null,    // No emoji icon — this is the home/landing plugin
  description: 'Fitness Health Dashboard',
  modes: {
    standalone: true,
    overlay: false,
    sidebar: false,
    mini: false,
  },
  requires: {
    sessionActive: false,
    participants: false,
    heartRate: false,
    governance: false,
  },
  pauseVideoOnLaunch: false,
  exitOnVideoEnd: false,
};
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/manifest.js
git commit -m "chore(dashboard): update HomeApp manifest for health dashboard"
```

---

### Task 9: Verify end-to-end in browser

Start the dev server and verify the dashboard renders correctly.

**Step 1: Check if dev server is running**

Run: `lsof -i :3111`

If not running, start it:

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev`

Wait for Vite to report ready.

**Step 2: Navigate to the fitness app home plugin**

Open browser to `http://localhost:3111/fitness/plugin/home` (or whatever port the dev server uses).

**Step 3: Verify rendering**

Check that:
- [ ] Dashboard renders without console errors
- [ ] Live weight data appears (if available in local data)
- [ ] Live nutrition data appears (if meals are logged)
- [ ] Recent workouts appear (if workout data exists)
- [ ] If agent has run: Up Next card shows with thumbnail
- [ ] If agent hasn't run: Empty state messages show for curated/coach sections
- [ ] All touch targets are at least 48px tall
- [ ] Dark theme looks correct

**Step 4: Fix any issues found during visual verification**

Common issues to watch for:
- Import path errors (check browser console)
- Missing context values (check FitnessContext exposure)
- API endpoint 404s (verify backend routes are mounted)
- Layout overflow on the TV viewport size

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(dashboard): address visual verification issues"
```

---

### Task 10: Handle edge cases and polish

Final polish pass — handle loading skeletons, error boundaries, and ensure graceful degradation.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx`
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx`

**Step 1: Add skeleton loading for individual cards**

In `DashboardWidgets.jsx`, add a skeleton variant for each card that shows during loading:

```jsx
import { Skeleton } from '@mantine/core';

export function DashboardCardSkeleton({ height = 150 }) {
  return (
    <Paper className="dashboard-card" p="md" radius="md">
      <Skeleton height={12} width="40%" mb="sm" />
      <Skeleton height={height - 40} />
    </Paper>
  );
}
```

**Step 2: Add error boundary for the dashboard**

In `HomeApp.jsx`, wrap the entire dashboard in an error boundary that catches rendering errors and shows a retry button:

```jsx
import React from 'react';

class DashboardErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="dashboard-empty">
          <Text size="lg" c="red">Dashboard error</Text>
          <Text size="sm" c="dimmed">{this.state.error?.message}</Text>
          <Text
            size="sm"
            c="blue"
            mt="md"
            style={{ cursor: 'pointer' }}
            onPointerDown={() => this.setState({ hasError: false })}
          >
            Tap to retry
          </Text>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Wrap the `<Grid>` in HomeApp's return with `<DashboardErrorBoundary>`.

**Step 3: Ensure no-userId fallback works**

If `userId` is null (no users configured), the dashboard should show a helpful message instead of making API calls with null userId.

In HomeApp.jsx, add before the loading check:

```jsx
if (!userId) {
  return (
    <div className="dashboard-empty">
      <Text c="dimmed">No user profile configured</Text>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "feat(dashboard): add error boundary, loading skeletons, and edge case handling"
```

---

## What Remains (Future Phases)

This plan covers **Phase 3: Dashboard Frontend** from the original roadmap. The following phases are deferred:

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Agent Framework | **Complete** | 14 tasks, 77 tests |
| Phase 2: Health Coach Agent | **Complete** | 12 tasks, all tests passing |
| Phase 3: Dashboard Frontend | **This plan** | 10 tasks above |
| Phase 4: Program Awareness | Deferred | Program state tracking, inference, explicit declaration |
| Phase 5: Interactive Coaching | Deferred | Voice memo prompts, multiple-choice responses, goal setting |
| Phase 6: Multi-User | Deferred | Per-user dashboards, user switching, parallel agent instances |

### Stress Test Items Addressed

| # | Issue | How Addressed |
|---|-------|---------------|
| #1 | Screen framework not used | **Intentionally skipped** — HomeApp plugin with Mantine Grid is simpler and sufficient. Screen framework is designed for standalone kiosk screens, not embedded plugin views. Can be revisited if widget reuse across contexts becomes needed. |
| #4 | Dashboard staleness | CoachCard filters stale CTAs by checking live nutrition data. Up Next card shows agent recommendation as-is (consumed state deferred to Phase 5). |
| #7 | Phase ordering | State widgets work without the agent. Dashboard gracefully degrades when no agent output exists. |

