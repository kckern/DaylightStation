# Health Dashboard Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hub + drill-down health dashboard frontend on top of the existing `GET /health/dashboard` API, with inline nutrition input and Highcharts history visualization.

**Architecture:** Rewrite HealthApp.jsx to fetch from `/health/dashboard`, render a card grid hub, and support drill-down to detail views. Uses existing DashboardCard pattern from fitness widgets, Mantine 7.11 for UI, Highcharts for multi-y-axis history chart. NutritionCard has a progressive in-place state machine for food logging.

**Tech Stack:** React, Mantine 7.11, Highcharts, DaylightAPI, existing DashboardCard component.

**Spec:** `docs/superpowers/specs/2026-04-03-health-frontend-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/Apps/HealthApp.jsx` | Rewrite | Page shell, data fetch, view routing (hub vs detail) |
| `frontend/src/Apps/HealthApp.scss` | Rewrite | Page-level and card grid styles |
| `frontend/src/modules/Health/HealthHub.jsx` | Create | Card grid layout |
| `frontend/src/modules/Health/HealthDetail.jsx` | Create | Detail view shell with back button |
| `frontend/src/modules/Health/cards/WeightCard.jsx` | Create | Today's weight summary card |
| `frontend/src/modules/Health/cards/NutritionCard.jsx` | Create | Nutrition summary + inline input |
| `frontend/src/modules/Health/cards/SessionsCard.jsx` | Create | Today's fitness sessions card |
| `frontend/src/modules/Health/cards/RecencyCard.jsx` | Create | Recency traffic-light indicators |
| `frontend/src/modules/Health/cards/GoalsCard.jsx` | Create | Active goals with progress bars |
| `frontend/src/modules/Health/detail/HistoryChart.jsx` | Create | Highcharts multi-y-axis chart |
| `frontend/src/modules/Health/detail/WeightDetail.jsx` | Create | Weight drill-down |
| `frontend/src/modules/Health/detail/NutritionDetail.jsx` | Create | Nutrition drill-down |
| `frontend/src/modules/Health/detail/SessionsDetail.jsx` | Create | Sessions drill-down |
| `frontend/src/modules/Health/detail/GoalsDetail.jsx` | Create | Goals drill-down |

---

### Task 1: HealthApp shell + styles

**Files:**
- Rewrite: `frontend/src/Apps/HealthApp.jsx`
- Rewrite: `frontend/src/Apps/HealthApp.scss`

- [ ] **Step 1: Rewrite HealthApp.jsx**

```jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MantineProvider, Skeleton } from '@mantine/core';
import '@mantine/core/styles.css';
import './HealthApp.scss';
import { DaylightAPI } from '../lib/api.mjs';
import { getChildLogger } from '../lib/logging/singleton.js';
import HealthHub from '../modules/Health/HealthHub';
import HealthDetail from '../modules/Health/HealthDetail';

const HealthApp = () => {
  const logger = useMemo(() => getChildLogger({ app: 'health' }), []);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('hub');
  const [detailType, setDetailType] = useState(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await DaylightAPI('/api/v1/health/dashboard');
      setDashboard(data);
    } catch (err) {
      logger.error('health.dashboard.fetch.failed', { error: err?.message });
    } finally {
      setLoading(false);
    }
  }, [logger]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const openDetail = useCallback((type) => {
    setDetailType(type);
    setView('detail');
  }, []);

  const backToHub = useCallback(() => {
    setView('hub');
    setDetailType(null);
  }, []);

  if (loading) {
    return (
      <MantineProvider>
        <div className="health-app">
          <Skeleton height={200} mb="md" />
          <Skeleton height={200} mb="md" />
        </div>
      </MantineProvider>
    );
  }

  return (
    <MantineProvider>
      <div className="health-app">
        {view === 'hub' ? (
          <HealthHub
            dashboard={dashboard}
            onCardClick={openDetail}
            onRefresh={fetchDashboard}
          />
        ) : (
          <HealthDetail
            type={detailType}
            dashboard={dashboard}
            onBack={backToHub}
          />
        )}
      </div>
    </MantineProvider>
  );
};

export default HealthApp;
```

- [ ] **Step 2: Write HealthApp.scss**

```scss
.health-app {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
  color: white;
}

.health-hub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
}

.health-detail {
  &__back {
    cursor: pointer;
    margin-bottom: 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;

    &:hover {
      color: white;
    }
  }
}

// Nutrition input states
.nutrition-input {
  margin-top: 0.5rem;

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }
}

.nutrition-review {
  &__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
}

// Recency grid
.recency-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
}

.recency-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;

    &--green { background: #40c057; }
    &--yellow { background: #fab005; }
    &--red { background: #fa5252; }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/HealthApp.jsx frontend/src/Apps/HealthApp.scss
git commit -m "feat(health-ui): rewrite HealthApp shell with hub/detail view routing"
```

---

### Task 2: HealthHub + HealthDetail shells

**Files:**
- Create: `frontend/src/modules/Health/HealthHub.jsx`
- Create: `frontend/src/modules/Health/HealthDetail.jsx`

- [ ] **Step 1: Create HealthHub.jsx**

```jsx
import React from 'react';
import { Title } from '@mantine/core';
import WeightCard from './cards/WeightCard';
import NutritionCard from './cards/NutritionCard';
import SessionsCard from './cards/SessionsCard';
import RecencyCard from './cards/RecencyCard';
import GoalsCard from './cards/GoalsCard';

export default function HealthHub({ dashboard, onCardClick, onRefresh }) {
  if (!dashboard) return null;
  const { today, recency, goals } = dashboard;

  return (
    <>
      <Title order={2} mb="md" c="white">Health</Title>
      <div className="health-hub-grid">
        <WeightCard
          weight={today?.weight}
          recency={recency?.find(r => r.source === 'weight')}
          onClick={() => onCardClick('weight')}
        />
        <NutritionCard
          nutrition={today?.nutrition}
          onRefresh={onRefresh}
          onClick={() => onCardClick('nutrition')}
        />
        <SessionsCard
          sessions={today?.sessions}
          onClick={() => onCardClick('sessions')}
        />
        <RecencyCard recency={recency} />
        <GoalsCard
          goals={goals}
          onClick={() => onCardClick('goals')}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create HealthDetail.jsx**

```jsx
import React from 'react';
import { Text } from '@mantine/core';
import HistoryChart from './detail/HistoryChart';
import WeightDetail from './detail/WeightDetail';
import NutritionDetail from './detail/NutritionDetail';
import SessionsDetail from './detail/SessionsDetail';
import GoalsDetail from './detail/GoalsDetail';

const TITLES = {
  weight: 'Weight',
  nutrition: 'Nutrition',
  sessions: 'Sessions',
  goals: 'Goals',
};

export default function HealthDetail({ type, dashboard, onBack }) {
  const showChart = type !== 'goals';

  return (
    <div className="health-detail">
      <Text
        className="health-detail__back"
        onClick={onBack}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onBack(); }}
      >
        ← {TITLES[type] || 'Back'}
      </Text>

      {showChart && dashboard?.history && (
        <HistoryChart history={dashboard.history} />
      )}

      {type === 'weight' && <WeightDetail dashboard={dashboard} />}
      {type === 'nutrition' && <NutritionDetail dashboard={dashboard} />}
      {type === 'sessions' && <SessionsDetail dashboard={dashboard} />}
      {type === 'goals' && <GoalsDetail goals={dashboard?.goals} />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Health/HealthHub.jsx frontend/src/modules/Health/HealthDetail.jsx
git commit -m "feat(health-ui): add HealthHub and HealthDetail shell components"
```

---

### Task 3: Hub cards (Weight, Sessions, Recency, Goals)

**Files:**
- Create: `frontend/src/modules/Health/cards/WeightCard.jsx`
- Create: `frontend/src/modules/Health/cards/SessionsCard.jsx`
- Create: `frontend/src/modules/Health/cards/RecencyCard.jsx`
- Create: `frontend/src/modules/Health/cards/GoalsCard.jsx`

- [ ] **Step 1: Create WeightCard.jsx**

```jsx
import React from 'react';
import { Text, Title, Stack, Badge } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function WeightCard({ weight, recency, onClick }) {
  if (!weight) {
    return (
      <DashboardCard title="Weight" icon="⚖️" onClick={onClick}>
        <Text c="dimmed" ta="center" py="md">No weight data</Text>
      </DashboardCard>
    );
  }

  const trend = weight.trend;
  const trendArrow = trend < 0 ? '↓' : trend > 0 ? '↑' : '→';
  const trendColor = trend < 0 ? 'green' : trend > 0 ? 'red' : 'gray';
  const daysAgo = recency?.daysSince;

  return (
    <DashboardCard title="Weight" icon="⚖️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {weight.lbs?.toFixed(1)}
        </Title>
        <Text size="sm" c="dimmed">lbs</Text>
        {trend != null && (
          <Badge color={trendColor} variant="light" size="lg">
            {trendArrow} {Math.abs(trend).toFixed(2)} / day
          </Badge>
        )}
        {daysAgo != null && (
          <Text size="xs" c="dimmed">
            {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
          </Text>
        )}
      </Stack>
    </DashboardCard>
  );
}
```

- [ ] **Step 2: Create SessionsCard.jsx**

```jsx
import React from 'react';
import { Text, Title, Stack, Group, Badge } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function SessionsCard({ sessions, onClick }) {
  const count = sessions?.length || 0;
  const totalCoins = sessions?.reduce((t, s) => t + (s.totalCoins || 0), 0) || 0;
  const latest = sessions?.[0];

  return (
    <DashboardCard title="Sessions" icon="🏋️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">{count}</Title>
        <Text size="sm" c="dimmed">today</Text>
        {totalCoins > 0 && (
          <Badge color="yellow" variant="light" size="lg">
            🪙 {totalCoins}
          </Badge>
        )}
        {latest?.title && (
          <Text size="xs" c="dimmed" ta="center" lineClamp={1}>
            {latest.showTitle ? `${latest.showTitle}: ` : ''}{latest.title}
          </Text>
        )}
      </Stack>
    </DashboardCard>
  );
}
```

- [ ] **Step 3: Create RecencyCard.jsx**

```jsx
import React from 'react';
import { Text } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function RecencyCard({ recency }) {
  if (!recency?.length) {
    return (
      <DashboardCard title="Self-Care" icon="🧠">
        <Text c="dimmed" ta="center" py="md">No data</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Self-Care" icon="🧠">
      <div className="recency-grid">
        {recency.map((item) => (
          <div key={item.source} className="recency-item">
            <div className={`recency-item__dot recency-item__dot--${item.status}`} />
            <div>
              <Text size="xs" fw={500}>{item.name}</Text>
              <Text size="xs" c="dimmed">
                {item.daysSince === 0 ? 'Today' : `${item.daysSince}d`}
              </Text>
            </div>
          </div>
        ))}
      </div>
    </DashboardCard>
  );
}
```

- [ ] **Step 4: Create GoalsCard.jsx**

```jsx
import React from 'react';
import { Text, Stack, Progress, Group } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';

export default function GoalsCard({ goals, onClick }) {
  if (!goals?.length) {
    return (
      <DashboardCard title="Goals" icon="🎯" onClick={onClick}>
        <Text c="dimmed" ta="center" py="md">No active goals</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Goals" icon="🎯" onClick={onClick}>
      <Stack gap="sm">
        {goals.map((goal) => {
          const metric = goal.metrics?.[0];
          const pct = metric?.target > 0
            ? Math.min(100, Math.round((metric.current / metric.target) * 100))
            : 0;

          return (
            <div key={goal.id}>
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={500} lineClamp={1} style={{ flex: 1 }}>
                  {goal.name}
                </Text>
                {metric && (
                  <Text size="xs" c="dimmed">
                    {metric.current}/{metric.target}
                  </Text>
                )}
              </Group>
              <Progress value={pct} size="sm" color={pct >= 100 ? 'green' : 'blue'} />
            </div>
          );
        })}
      </Stack>
    </DashboardCard>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/cards/
git commit -m "feat(health-ui): add Weight, Sessions, Recency, Goals hub cards"
```

---

### Task 4: NutritionCard with inline input

**Files:**
- Create: `frontend/src/modules/Health/cards/NutritionCard.jsx`

- [ ] **Step 1: Create NutritionCard.jsx**

This is the most complex card — it has four in-place states.

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Text, Title, Stack, Badge, Group, TextInput, Button, Skeleton, ActionIcon } from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';
import { DaylightAPI } from '../../../lib/api.mjs';

export default function NutritionCard({ nutrition, onRefresh, onClick }) {
  const [inputState, setInputState] = useState('idle'); // idle | parsing | review
  const [inputText, setInputText] = useState('');
  const [reviewItems, setReviewItems] = useState([]);
  const [recentCatalog, setRecentCatalog] = useState([]);

  // Load recent catalog for quick-add chips
  useEffect(() => {
    DaylightAPI('/api/v1/health/nutrition/catalog/recent?limit=5')
      .then(res => setRecentCatalog(res?.items || []))
      .catch(() => {});
  }, [inputState]); // refresh after input cycle

  const handleSubmit = useCallback(async () => {
    if (!inputText.trim()) return;
    setInputState('parsing');
    try {
      const result = await DaylightAPI('/api/v1/health/nutrition/input', {
        type: 'text',
        content: inputText.trim(),
      }, 'POST');
      // Items are already logged by the API
      setReviewItems(result?.items || result?.messages || []);
      setInputState('review');
    } catch (err) {
      setInputState('idle');
    }
  }, [inputText]);

  const handleAccept = useCallback(() => {
    setInputText('');
    setReviewItems([]);
    setInputState('idle');
    onRefresh?.();
  }, [onRefresh]);

  const handleUndo = useCallback(() => {
    // For v1, just dismiss — items already logged
    setInputText('');
    setReviewItems([]);
    setInputState('idle');
  }, []);

  const handleQuickAdd = useCallback(async (entryId) => {
    try {
      await DaylightAPI('/api/v1/health/nutrition/catalog/quickadd', {
        catalogEntryId: entryId,
      }, 'POST');
      onRefresh?.();
    } catch (err) {
      // silent fail
    }
  }, [onRefresh]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

  // --- Review state ---
  if (inputState === 'review') {
    return (
      <DashboardCard title="Nutrition" icon="🍽️">
        <Stack gap="xs">
          {reviewItems.map((item, i) => (
            <div key={i} className="nutrition-review__item">
              <Text size="sm">{item.text || item.name || item.label || JSON.stringify(item)}</Text>
            </div>
          ))}
          <div className="nutrition-review__actions">
            <Button size="xs" color="green" onClick={handleAccept}>Accept</Button>
            <Button size="xs" color="gray" variant="outline" onClick={handleUndo}>Undo</Button>
          </div>
        </Stack>
      </DashboardCard>
    );
  }

  // --- Parsing state ---
  if (inputState === 'parsing') {
    return (
      <DashboardCard title="Nutrition" icon="🍽️">
        <Stack gap="xs" align="center" py="md">
          <Skeleton height={16} width="60%" />
          <Text size="xs" c="dimmed">Analyzing...</Text>
        </Stack>
      </DashboardCard>
    );
  }

  // --- Idle state ---
  const cals = nutrition?.calories;

  return (
    <DashboardCard title="Nutrition" icon="🍽️" onClick={onClick}>
      <Stack gap={4} align="center">
        <Title order={2} className="dashboard-stat-value">
          {cals != null ? Math.round(cals) : '—'}
        </Title>
        <Text size="sm" c="dimmed">calories</Text>
        {nutrition && (
          <Group gap={4} justify="center">
            {nutrition.protein != null && <Badge color="blue" variant="light" size="sm">P {Math.round(nutrition.protein)}g</Badge>}
            {nutrition.carbs != null && <Badge color="yellow" variant="light" size="sm">C {Math.round(nutrition.carbs)}g</Badge>}
            {nutrition.fat != null && <Badge color="orange" variant="light" size="sm">F {Math.round(nutrition.fat)}g</Badge>}
          </Group>
        )}
      </Stack>

      <div className="nutrition-input" onClick={(e) => e.stopPropagation()}>
        <TextInput
          placeholder="Log food..."
          size="xs"
          value={inputText}
          onChange={(e) => setInputText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          styles={{ input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' } }}
        />
        {recentCatalog.length > 0 && (
          <div className="nutrition-input__chips">
            {recentCatalog.map((entry) => (
              <Badge
                key={entry.id}
                size="xs"
                variant="outline"
                color="gray"
                style={{ cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); handleQuickAdd(entry.id); }}
              >
                {entry.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Health/cards/NutritionCard.jsx
git commit -m "feat(health-ui): add NutritionCard with inline input and quick-add chips"
```

---

### Task 5: HistoryChart (Highcharts multi-y-axis)

**Files:**
- Create: `frontend/src/modules/Health/detail/HistoryChart.jsx`

- [ ] **Step 1: Create HistoryChart.jsx**

```jsx
import React, { useState, useMemo } from 'react';
import { Group, Button } from '@mantine/core';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const RANGES = [
  { key: '90d', label: '90 Days' },
  { key: '6mo', label: '6 Months' },
  { key: '2yr', label: '2 Years' },
];

function buildChartData(history, range) {
  let entries;
  switch (range) {
    case '6mo':
      entries = [
        ...(history.daily || []),
        ...(history.weekly || []),
      ];
      break;
    case '2yr':
      entries = [
        ...(history.daily || []),
        ...(history.weekly || []),
        ...(history.monthly || []),
      ];
      break;
    default: // 90d
      entries = history.daily || [];
  }

  // Sort by date ascending
  entries = entries
    .map(e => ({
      date: e.date || e.startDate,
      weight: typeof e.weight === 'number' ? e.weight : e.weight?.lbs || null,
      calories: typeof e.nutrition === 'object' ? e.nutrition?.calories : null,
      workoutMinutes: e.workouts?.totalMinutes ?? (
        Array.isArray(e.workouts)
          ? e.workouts.reduce((t, w) => t + (w.duration || 0), 0)
          : 0
      ),
    }))
    .filter(e => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return entries;
}

export default function HistoryChart({ history }) {
  const [range, setRange] = useState('90d');

  const chartOptions = useMemo(() => {
    const data = buildChartData(history, range);
    const categories = data.map(d => d.date);

    return {
      chart: {
        backgroundColor: 'transparent',
        height: 300,
      },
      title: { text: null },
      xAxis: {
        categories,
        labels: {
          style: { color: '#999', fontSize: '10px' },
          step: Math.max(1, Math.floor(categories.length / 10)),
          rotation: -45,
        },
        lineColor: 'rgba(255,255,255,0.1)',
      },
      yAxis: [
        {
          // Left: Weight
          title: { text: 'Weight (lbs)', style: { color: '#7cb5ec' } },
          labels: { style: { color: '#7cb5ec' } },
          gridLineColor: 'rgba(255,255,255,0.05)',
        },
        {
          // Right: Calories
          title: { text: 'Calories', style: { color: '#f7a35c' } },
          labels: { style: { color: '#f7a35c' } },
          opposite: true,
          gridLineColor: 'transparent',
        },
        {
          // Far right: Workout minutes
          title: { text: 'Workout (min)', style: { color: '#90ed7d' } },
          labels: { style: { color: '#90ed7d' } },
          opposite: true,
          gridLineColor: 'transparent',
        },
      ],
      series: [
        {
          name: 'Weight',
          type: 'spline',
          yAxis: 0,
          data: data.map(d => d.weight),
          color: '#7cb5ec',
          connectNulls: true,
          marker: { radius: 2 },
        },
        {
          name: 'Calories',
          type: 'line',
          yAxis: 1,
          data: data.map(d => d.calories),
          color: '#f7a35c',
          connectNulls: true,
          marker: { radius: 1 },
          dashStyle: 'ShortDash',
        },
        {
          name: 'Workout',
          type: 'column',
          yAxis: 2,
          data: data.map(d => d.workoutMinutes || 0),
          color: 'rgba(144, 237, 125, 0.5)',
          borderWidth: 0,
        },
      ],
      legend: {
        itemStyle: { color: '#ccc', fontSize: '11px' },
      },
      tooltip: {
        shared: true,
        backgroundColor: 'rgba(30, 30, 50, 0.9)',
        style: { color: '#fff' },
        borderColor: 'rgba(255,255,255,0.1)',
      },
      credits: { enabled: false },
    };
  }, [history, range]);

  return (
    <div>
      <Group gap="xs" mb="sm">
        {RANGES.map(r => (
          <Button
            key={r.key}
            size="xs"
            variant={range === r.key ? 'filled' : 'outline'}
            color="gray"
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </Group>
      <HighchartsReact highcharts={Highcharts} options={chartOptions} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/Health/detail/HistoryChart.jsx
git commit -m "feat(health-ui): add HistoryChart with multi-y-axis (weight, calories, workouts)"
```

---

### Task 6: Detail views (Weight, Nutrition, Sessions, Goals)

**Files:**
- Create: `frontend/src/modules/Health/detail/WeightDetail.jsx`
- Create: `frontend/src/modules/Health/detail/NutritionDetail.jsx`
- Create: `frontend/src/modules/Health/detail/SessionsDetail.jsx`
- Create: `frontend/src/modules/Health/detail/GoalsDetail.jsx`

- [ ] **Step 1: Create WeightDetail.jsx**

```jsx
import React from 'react';
import { Text, Stack, Group, Paper } from '@mantine/core';

export default function WeightDetail({ dashboard }) {
  const history = dashboard?.history?.daily || [];
  const recent = history
    .filter(d => d.weight?.lbs != null)
    .slice(0, 14);

  if (!recent.length) {
    return <Text c="dimmed" py="md">No recent weight data</Text>;
  }

  return (
    <Stack gap="xs" mt="md">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase">Recent Readings</Text>
      {recent.map(day => (
        <Paper key={day.date} p="xs" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <Group justify="space-between">
            <Text size="sm">{day.date}</Text>
            <Group gap="sm">
              <Text size="sm" fw={600}>{day.weight.lbs?.toFixed(1)} lbs</Text>
              {day.weight.trend != null && (
                <Text size="xs" c={day.weight.trend < 0 ? 'green' : day.weight.trend > 0 ? 'red' : 'dimmed'}>
                  {day.weight.trend > 0 ? '+' : ''}{day.weight.trend?.toFixed(2)}
                </Text>
              )}
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
```

- [ ] **Step 2: Create NutritionDetail.jsx**

```jsx
import React, { useState, useEffect } from 'react';
import { Text, Stack, Group, Paper, TextInput, Badge } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';

export default function NutritionDetail({ dashboard }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const history = dashboard?.history?.daily || [];

  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await DaylightAPI(`/api/v1/health/nutrition/catalog?q=${encodeURIComponent(searchQuery)}&limit=10`);
        setSearchResults(res?.items || []);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const recentDays = history.filter(d => d.nutrition?.calories != null).slice(0, 14);

  return (
    <Stack gap="md" mt="md">
      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Search Catalog</Text>
        <TextInput
          placeholder="Search foods..."
          size="xs"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          styles={{ input: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' } }}
        />
        {searchResults.length > 0 && (
          <Stack gap={4} mt="xs">
            {searchResults.map(item => (
              <Paper key={item.id} p="xs" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Group justify="space-between">
                  <Text size="sm">{item.name}</Text>
                  <Group gap="xs">
                    <Badge size="xs" color="gray">{item.nutrients?.calories || 0} cal</Badge>
                    <Text size="xs" c="dimmed">×{item.useCount}</Text>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </div>

      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Recent Days</Text>
        {recentDays.map(day => (
          <Paper key={day.date} p="xs" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between">
              <Text size="sm">{day.date}</Text>
              <Text size="sm" fw={600}>{Math.round(day.nutrition.calories)} cal</Text>
            </Group>
          </Paper>
        ))}
      </div>
    </Stack>
  );
}
```

- [ ] **Step 3: Create SessionsDetail.jsx**

```jsx
import React from 'react';
import { Text, Stack, Group, Paper, Badge } from '@mantine/core';

export default function SessionsDetail({ dashboard }) {
  const sessions = dashboard?.today?.sessions || [];
  const history = dashboard?.history?.daily || [];
  const recentWithSessions = history.filter(d =>
    (Array.isArray(d.workouts) && d.workouts.length > 0) ||
    (d.sessions?.count > 0)
  ).slice(0, 14);

  return (
    <Stack gap="md" mt="md">
      {sessions.length > 0 && (
        <div>
          <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Today</Text>
          {sessions.map(s => (
            <Paper key={s.sessionId} p="sm" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={500}>{s.title}</Text>
                  {s.showTitle && <Text size="xs" c="dimmed">{s.showTitle}</Text>}
                </div>
                <Group gap="xs">
                  <Badge color="blue" variant="light" size="sm">
                    {Math.round((s.durationMs || 0) / 60000)} min
                  </Badge>
                  {s.totalCoins > 0 && (
                    <Badge color="yellow" variant="light" size="sm">🪙 {s.totalCoins}</Badge>
                  )}
                </Group>
              </Group>
            </Paper>
          ))}
        </div>
      )}

      <div>
        <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb="xs">Recent Activity</Text>
        {recentWithSessions.map(day => (
          <Paper key={day.date} p="xs" radius="sm" mb={4} style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between">
              <Text size="sm">{day.date}</Text>
              <Text size="xs" c="dimmed">
                {Array.isArray(day.workouts) ? `${day.workouts.length} workouts` : ''}
              </Text>
            </Group>
          </Paper>
        ))}
      </div>
    </Stack>
  );
}
```

- [ ] **Step 4: Create GoalsDetail.jsx**

```jsx
import React from 'react';
import { Text, Stack, Paper, Progress, Group, Badge } from '@mantine/core';

export default function GoalsDetail({ goals }) {
  if (!goals?.length) {
    return <Text c="dimmed" py="md">No active goals</Text>;
  }

  return (
    <Stack gap="md" mt="md">
      {goals.map(goal => {
        const metric = goal.metrics?.[0];
        const pct = metric?.target > 0
          ? Math.min(100, Math.round((metric.current / metric.target) * 100))
          : 0;

        return (
          <Paper key={goal.id} p="md" radius="sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={600}>{goal.name}</Text>
              <Badge color={goal.state === 'committed' ? 'blue' : 'gray'} variant="light" size="sm">
                {goal.state}
              </Badge>
            </Group>
            {metric && (
              <>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">{metric.name}</Text>
                  <Text size="xs" c="dimmed">{metric.current} / {metric.target}</Text>
                </Group>
                <Progress value={pct} size="md" color={pct >= 100 ? 'green' : 'blue'} />
              </>
            )}
            {goal.deadline && (
              <Text size="xs" c="dimmed" mt="xs">
                Deadline: {new Date(goal.deadline).toLocaleDateString()}
              </Text>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Health/detail/
git commit -m "feat(health-ui): add Weight, Nutrition, Sessions, Goals detail views"
```

---

### Task 7: Build, deploy, verify

- [ ] **Step 1: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Verify in browser**

Navigate to `https://daylightlocal.kckern.net/health` and verify:
- Hub view loads with 5 cards
- Weight card shows current weight + trend
- Nutrition card shows calories + input field
- Sessions card shows today's session
- Recency card shows green/yellow/red dots
- Goals card shows progress bars
- Clicking a card opens the detail view with chart
- Back button returns to hub
- History chart shows weight + calories + workout bars
- 90d / 6mo / 2yr buttons switch chart range

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix(health-ui): post-deployment fixes"
```
