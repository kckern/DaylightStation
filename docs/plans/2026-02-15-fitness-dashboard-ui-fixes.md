# Fitness Dashboard UI Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues identified in the UI audit (`docs/_wip/audits/2026-02-15-fitness-dashboard-ui-audit.md`) — restyle the Weight widget, collapse empty cards, improve session list UX, and unify empty states.

**Architecture:** Replace the standalone `<Weight />` component (which fetches its own data and uses an opaque light theme) with the existing `<WeightTrendCard />` widget that uses `DashboardCard` styling and receives weight data from `useDashboardData`. Make the grid layout responsive to empty data — when UpNext or Coach have no data, expand their neighbors. Add date grouping to the session list. Unify all empty states inside `DashboardCard` wrappers.

**Tech Stack:** React, Mantine v7 (Grid, Text, Badge, Stack, Group, Paper), SCSS

---

### Task 1: Replace Weight component with WeightTrendCard

The standalone `Weight` component at `frontend/src/modules/Health/Weight.jsx` uses a completely different design language (opaque white table + Highcharts graph). The `WeightTrendCard` already exists in `DashboardWidgets.jsx` and uses the `DashboardCard` wrapper — it's just not wired up. This task switches to it.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx:1-163`
- No new files

**Step 1: Remove the Weight import and use WeightTrendCard**

In `HomeApp.jsx`, make these changes:

1. Remove the Weight import (line 13):
```jsx
// REMOVE this line:
import Weight from '@/modules/Health/Weight';
```

2. Add `WeightTrendCard` to the existing DashboardWidgets import (line 7-12):
```jsx
import {
  NutritionCard,
  WorkoutsCard,
  WeightTrendCard,
  UpNextCard,
  CoachCard,
} from './DashboardWidgets.jsx';
```

3. Replace `<Weight />` (line 139) with:
```jsx
<WeightTrendCard weight={liveData?.weight} />
```

**Step 2: Verify visually**

Open `http://localhost:3111/fitness/home` in a browser. The weight widget should now:
- Use the same semi-transparent dark card background as all other cards
- Show current weight (large number), unit label, 7-day trend badge, and body fat percentage
- Match the `DashboardCard` styling (not the old white table + chart)

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx
git commit -m "fix(dashboard): replace standalone Weight with themed WeightTrendCard"
```

---

### Task 2: Collapse empty UpNext card — give Sessions full width

When `dashboard.curated` is null (the common case — agent hasn't generated recommendations), the UpNext card shows orphaned dimmed text wasting 5/12 of the top row. Instead, give WorkoutsCard the full 12 columns.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx:119-157`

**Step 1: Make grid columns conditional on data**

Replace the Row 1 section (lines 122-135) with:

```jsx
<Grid gutter="md">
  {/* Row 1: Recent Sessions (expand if no curated data) */}
  <Grid.Col span={{ base: 12, md: dashboard?.curated ? 7 : 12 }}>
    <WorkoutsCard sessions={liveData?.sessions} />
  </Grid.Col>
  {dashboard?.curated && (
    <Grid.Col span={{ base: 12, md: 5 }}>
      <UpNextCard curated={dashboard.curated} onPlay={handlePlay} />
    </Grid.Col>
  )}
```

This removes the empty placeholder entirely when there's no curated content, and gives WorkoutsCard the full width.

**Step 2: Verify visually**

The sessions card should now span the full width of the dashboard when there's no UpNext data. If the agent has generated curated content, the 7/5 split should still apply.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx
git commit -m "fix(dashboard): collapse empty UpNext card, give sessions full width"
```

---

### Task 3: Collapse empty Coach card — let Nutrition expand

Same pattern as Task 2: when there's no coach data, the Coach card wastes 4/12 of the bottom row. Let Nutrition expand to fill.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx:137-156`

**Step 1: Make bottom row columns conditional**

Replace the Row 2 section with:

```jsx
  {/* Row 2: Weight + Nutrition + Coach (expand nutrition if no coach) */}
  <Grid.Col span={{ base: 12, md: 4 }}>
    <WeightTrendCard weight={liveData?.weight} />
  </Grid.Col>
  <Grid.Col span={{ base: 12, md: dashboard?.coach ? 4 : 8 }}>
    <NutritionCard nutrition={liveData?.nutrition} />
  </Grid.Col>
  {dashboard?.coach && (
    <Grid.Col span={{ base: 12, md: 4 }}>
      <CoachCard
        coach={dashboard.coach}
        liveNutrition={liveData?.nutrition}
        onCtaAction={handleCtaAction}
      />
    </Grid.Col>
  )}
</Grid>
```

**Step 2: Verify visually**

The bottom row should show Weight (4 cols) + Nutrition (8 cols) when there's no coach data. When coach data exists, it should be Weight (4) + Nutrition (4) + Coach (4).

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx
git commit -m "fix(dashboard): collapse empty Coach card, expand Nutrition"
```

---

### Task 4: Add date group headers to session list

The audit noted that dates like "Fri, Feb 13" repeat on multiple rows without visual grouping. Add subtle date headers between day groups. This replaces per-row date labels with group-level headers.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx:110-174`
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss`

**Step 1: Rewrite WorkoutsCard to group sessions by date**

Replace the `WorkoutsCard` function (lines 112-174) with:

```jsx
export function WorkoutsCard({ sessions }) {
  if (!sessions || sessions.length === 0) {
    return (
      <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
        <Text c="dimmed" ta="center" py="md">No recent sessions</Text>
      </DashboardCard>
    );
  }

  // Group sessions by date
  const groups = [];
  let currentDate = null;
  for (const s of sessions) {
    if (s.date !== currentDate) {
      currentDate = s.date;
      groups.push({ date: s.date, label: formatDate(s.date), sessions: [] });
    }
    groups[groups.length - 1].sessions.push(s);
  }

  return (
    <DashboardCard title="Recent Sessions" className="dashboard-card--workouts">
      <Stack gap="xs">
        {groups.map((group) => (
          <div key={group.date}>
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" className="session-date-header">
              {group.label}
            </Text>
            {group.sessions.map((s) => (
              <Group key={s.sessionId} gap="sm" wrap="nowrap" className="session-row">
                <img
                  src={`/api/v1/display/plex/${s.media.mediaId}`}
                  alt=""
                  className="session-thumbnail"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>{s.media.title}</Text>
                  {s.media.showTitle && (
                    <Text size="xs" c="dimmed" truncate>{s.media.showTitle}</Text>
                  )}
                  <Group gap="xs" wrap="nowrap">
                    {s.durationMs && (
                      <Badge variant="light" size="xs">{Math.round(s.durationMs / 60000)} min</Badge>
                    )}
                    {s.totalCoins > 0 && (
                      <Badge variant="light" size="xs" color="yellow">{s.totalCoins} coins</Badge>
                    )}
                  </Group>
                  {s.participants?.length > 0 && (
                    <Group gap={6} className="session-avatars">
                      {s.participants.map((p) => (
                        <img
                          key={p.id}
                          src={`/api/v1/static/users/${p.id}`}
                          alt={p.displayName}
                          title={p.displayName}
                          className="session-avatar"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ))}
                    </Group>
                  )}
                </Stack>
                {s.media.grandparentId && (
                  <img
                    src={`/api/v1/display/plex/${s.media.grandparentId}`}
                    alt=""
                    className="session-poster"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
              </Group>
            ))}
          </div>
        ))}
      </Stack>
    </DashboardCard>
  );
}
```

Key changes from the current version:
- Sessions are grouped by `s.date` and rendered under date headers
- Per-row date text is removed (it's now in the group header)
- Everything else (thumbnails, posters, avatars, coins, badges) stays the same

**Step 2: Add date header style**

Add to `HomeApp.scss` after the `.session-row` block (after line 152):

```scss
.session-date-header {
  padding: 0.4rem 0 0.15rem;
  letter-spacing: 0.05em;

  &:first-child {
    padding-top: 0;
  }
}
```

**Step 3: Verify visually**

Sessions should now be grouped under date headers like "TODAY", "YESTERDAY", "Thu, Feb 13". Each group shows its sessions below the header without repeating the date on every row.

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss
git commit -m "feat(dashboard): add date group headers to session list"
```

---

### Task 5: Vertically center show posters with row content

The audit noted posters float right but aren't vertically centered with their row content. The `session-row` Group uses `wrap="nowrap"` but doesn't set `align`. Add vertical centering.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss`

**Step 1: Add vertical centering to session rows**

Add `align-items: center` to the `.session-row` rule in `HomeApp.scss` (around line 148-152):

```scss
.session-row {
  padding: 0.35rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  align-items: center;
  &:last-child { border-bottom: none; }
}
```

**Step 2: Verify visually**

Show posters should now be vertically centered relative to the text block on each row, regardless of how many lines of text or avatars are present.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.scss
git commit -m "fix(dashboard): vertically center show posters in session rows"
```

---

### Task 6: Remove "cal" label repetition from NutritionCard

The audit noted the "cal" label repeats on every row. Move it to the header area and remove from rows.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx:73-108`

**Step 1: Update NutritionCard**

Replace the `NutritionCard` function (lines 75-102) with:

```jsx
export function NutritionCard({ nutrition }) {
  if (!nutrition || !Array.isArray(nutrition) || nutrition.length === 0) {
    return (
      <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
        <Text c="dimmed" ta="center" py="md">No nutrition data</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Nutrition (cal)" className="dashboard-card--nutrition">
      <Stack gap={4}>
        {nutrition.map((day) => (
          <Group key={day.date} justify="space-between" className="nutrition-row" wrap="nowrap">
            <Text size="xs" c="dimmed" w={70}>{formatDateShort(day.date)}</Text>
            <Text size="sm" fw={600} w={55} ta="right">{day.calories}</Text>
            <Group gap={4} style={{ flex: 1 }} justify="flex-end" wrap="nowrap">
              <Badge variant="light" size="xs" color="blue">{Math.round(day.protein)}p</Badge>
              <Badge variant="light" size="xs" color="yellow">{Math.round(day.carbs)}c</Badge>
              <Badge variant="light" size="xs" color="orange">{Math.round(day.fat)}f</Badge>
            </Group>
          </Group>
        ))}
      </Stack>
    </DashboardCard>
  );
}
```

Changes from original:
- Card title changed from `"Nutrition"` to `"Nutrition (cal)"` — puts the unit in the header
- Removed the `<Text size="xs" c="dimmed" w={20}>cal</Text>` element from each row

**Step 2: Verify visually**

Each nutrition row should now just show: date | calories | P/C/F badges — without a per-row "cal" label. The card title "NUTRITION (CAL)" indicates the unit.

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/DashboardWidgets.jsx
git commit -m "fix(dashboard): move cal label to NutritionCard header, remove from rows"
```

---

### Task 7: Remove unused Weight component import cleanup

After Task 1 removed the `Weight` import, the `DaylightMediaPath` import on line 14 of HomeApp.jsx may also be unused (it was only used for queue items which still need it). Verify and clean up any dead imports.

**Files:**
- Modify: `frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx`

**Step 1: Audit imports**

Check which imports are still needed. After Task 1:
- `Weight` — REMOVED (Task 1)
- `DaylightMediaPath` — still used in `handlePlay` (line 74-75), KEEP
- `WeightTrendCard` — ADDED (Task 1), KEEP
- All others — still used, KEEP

No changes needed if `DaylightMediaPath` is still referenced. If it's not, remove it.

**Step 2: Commit (if changes made)**

```bash
git add frontend/src/modules/Fitness/FitnessPlugins/plugins/HomeApp/HomeApp.jsx
git commit -m "chore(dashboard): remove unused imports"
```

---

### Task 8: Run Playwright image test to verify nothing broke

The existing test at `tests/live/flow/fitness/dashboard-images.runtime.test.mjs` checks that all dashboard images (thumbnails, posters, avatars) load correctly. Run it to confirm the UI changes didn't break image loading.

**Files:**
- No changes — just run the test

**Step 1: Start dev server if not running**

```bash
lsof -i :3111 || npm run dev &
```

**Step 2: Run the test**

```bash
npx playwright test tests/live/flow/fitness/dashboard-images.runtime.test.mjs --reporter=line
```

Expected: All images should load (same 20/20 as before: 5 thumbnails, 5 posters, 10 avatars).

**Step 3: If test fails, debug**

- If `.dashboard-card--workouts` selector isn't found, the WorkoutsCard may have a rendering error — check browser console
- If images are BROKEN, check the `src` URLs haven't changed
- If image count differs, the date grouping may have affected the DOM structure — verify `img` elements are still inside `.dashboard-card--workouts`

---

## File Summary

| File | Tasks | Changes |
|------|-------|---------|
| `HomeApp.jsx` | 1, 2, 3, 7 | Replace Weight with WeightTrendCard, conditional grid spans, import cleanup |
| `DashboardWidgets.jsx` | 4, 6 | Date-grouped sessions, NutritionCard cal label |
| `HomeApp.scss` | 4, 5 | Date header style, poster vertical centering |

## Final State

After all tasks, the dashboard should:
- Use a unified dark semi-transparent card style for ALL widgets (no more jarring white Weight table)
- Expand sessions to full width when no curated content exists
- Expand nutrition when no coach data exists
- Show sessions grouped by date with subtle headers
- Have vertically centered show posters
- Remove per-row "cal" labels from nutrition
