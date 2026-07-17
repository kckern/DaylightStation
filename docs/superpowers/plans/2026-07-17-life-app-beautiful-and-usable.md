# Life App — Beautiful & Usable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Life app from "functional but undesigned and confusing" to a beautiful, lifecycle-aware, trustworthy experience — a real design system, empty/loading/error consistency, a coach that knows who it's talking to, and alerts that are specific and dismissable.

**Architecture:** Front to back, in five phases. Phase 1–2 install a design substrate (Mantine dark theme + semantic-color/format modules + shared page primitives) and sweep the 20 views onto it, fixing visual defects. Phase 3 fixes the backend usability bugs (purpose genesis route, false-positive drift/anti-goal alerts) and adds a server-computed `stage`/`completeness` model plus `ceremony_due`/`plan_gap` priorities with human-readable copy. Phase 4 wires the frontend to that model (fix the silent-swallow purpose editor, a lifecycle dashboard, dismissable alerts). Phase 5 makes the coach's identity infrastructural and grounds it in the real plan.

**Tech Stack:** React 18 + Mantine 7 (`@mantine/core`, `@mantine/notifications`), react-router-dom, Tabler icons; Node ESM backend (DDD layers under `backend/src/`); Vitest for both frontend (`.test.jsx`, `@testing-library/react`, happy-dom env) and backend (`.test.mjs` under `tests/isolated/`).

## Global Constraints

- **Color scheme: dark.** The Life theme commits to `defaultColorScheme="dark"`, matching `HealthApp` and the household kiosk displays. Every color decision assumes a dark surface.
- **Logging:** Never use raw `console.*`. Use the framework — components: `getLogger().child({ component })` via `useMemo`; modules: lazy `getChildLogger`. (`frontend/src/lib/logging/Logger.js`, `singleton.js`.)
- **Backend layer discipline:** entities/services in `2_domains` take no I/O; application services in `3_applications` orchestrate; routers in `4_api` are thin. Do not add `Date.now()` inside domain code — clock reads are passed in (repo convention, audit D-5).
- **Test runner commands:** single frontend file → `npx vitest run <path/to/file.test.jsx>`; single backend file → `npx vitest run <path/to/file.test.mjs>`. Both pick up the root `vitest.config.mjs` (JSX auto-runtime, aliases, happy-dom env, `frontend/src/test-setup.js`). New backend isolated tests must pass `scripts/gate-vitest.mjs` (they will if green).
- **No new dependencies.** Everything here is buildable with the installed Mantine/Tabler/router stack.
- **Commit cadence:** one commit per task, message form `feat(life-ui): …` / `fix(life): …` / `feat(lifeplan): …` matching existing history. End commit messages with the Co-Authored-By trailer.
- **Deploy discipline (kckern-server):** building/deploying is allowed, but NEVER redeploy during an active fitness session or a playing Player video, and after any `frontend/src/modules/Fitness/` change reload the garage kiosk. This plan touches neither, but the redeploy gate still applies — see `CLAUDE.local.md`.
- **After a deploy that changes Life UI, hard-reload the garage kiosk Firefox** (`CLAUDE.local.md` → "Fitness Display — reloading after a deploy") if the Life app is being viewed there.

---

## File Structure

**New files:**
- `frontend/src/Apps/LifeApp.theme.js` — Mantine dark theme (tokens + component defaults). Mirrors `HealthApp.theme.js`.
- `frontend/src/Apps/LifeApp.scss` — the few kiosk/hover rules Mantine props can't express.
- `frontend/src/modules/Life/theme/semantics.js` — single source of semantic colors (`goalStateColor`, `beliefConfidenceColor`, `driftStatusColor`, `priorityTypeMeta`). Kills 5 duplicated maps.
- `frontend/src/modules/Life/theme/semantics.test.jsx` — unit tests for the above.
- `frontend/src/modules/Life/lib/format.js` — `formatDate`, `formatDateRange`, `formatPeriodLabel`, `humanize`. Kills raw ISO/IDs in the DOM.
- `frontend/src/modules/Life/lib/format.test.jsx` — unit tests.
- `frontend/src/modules/Life/components/` — `LifePage.jsx`, `SectionCard.jsx`, `EmptyState.jsx`, `LoadingState.jsx`, `ErrorState.jsx`, `index.js`, plus `components.test.jsx`.
- `frontend/src/modules/Life/hooks/useLifeStage.js` — thin hook exposing the backend `stage`/`completeness` model.

**Modified (frontend):** `LifeApp.jsx` (theme, chrome), `widgets/{GoalProgressBar,BeliefConfidenceChip,CadenceIndicator,DriftGauge,ValueAllocationChart}.jsx`, `views/plan/{PurposeView,GoalsView,GoalDetail,BeliefsView,ValuesView,QualitiesView,CeremonyConfig}.jsx`, `views/now/{Dashboard,PriorityList,Briefing}.jsx`, `views/log/**` (loading/error/format sweep), `views/log/shared/ActivityHeatmap.jsx` (defect), `views/ceremony/{CeremonyFlow,UnitCapture,CycleRetro}.jsx`, `hooks/useLifePlan.js` (setPurpose, rethrow).

**Modified (backend):** `4_api/v1/routers/life/plan.mjs` (POST /purpose), `3_applications/lifeplan/services/{AlignmentService,CeremonyScheduler,PlanAuthoringService}.mjs`, `2_domains/lifeplan/services/ValueDriftCalculator.mjs`, `2_domains/lifeplan/entities/AntiGoal.mjs`, the lifeplan composition root, and the coach: `3_applications/agents/lifeplan-guide/{LifeplanGuideAgent.mjs, tools/PlanToolFactory.mjs, prompts/system.mjs}`, `3_applications/agents/framework/{BaseAgent.mjs, Assignment.mjs, decorators/UserIdInjector.mjs}`.

**Test homes:** frontend tests co-locate as `*.test.jsx`; backend isolated tests go under `tests/isolated/lifeplan/services/`, `tests/isolated/api/`, `tests/isolated/agents/lifeplan-guide/`. Reuse `tests/_lib/lifeplan-test-factory.mjs` (`createTestLifeplan`).

---

## Phase 1 — Design foundation (pure additive; no view touched yet)

### Task 1: Life dark theme

**Files:**
- Create: `frontend/src/Apps/LifeApp.theme.js`
- Test: `frontend/src/Apps/LifeApp.theme.test.js`
- Modify: `frontend/src/Apps/LifeApp.jsx:85` (apply theme + scheme), `frontend/src/Apps/LifeApp.jsx:2` (import)

**Interfaces:**
- Produces: `export const lifeTheme` (a Mantine `createTheme` result) and `export default lifeTheme`.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/Apps/LifeApp.theme.test.js
import { describe, it, expect } from 'vitest';
import { lifeTheme } from './LifeApp.theme.js';

describe('lifeTheme', () => {
  it('is a dark, deliberate theme with card defaults', () => {
    expect(lifeTheme.primaryColor).toBe('violet');
    expect(lifeTheme.defaultRadius).toBe('md');
    // Surface/border token scales exist (10 shades each) for card layering.
    expect(lifeTheme.colors.surface).toHaveLength(10);
    expect(lifeTheme.colors.border).toHaveLength(10);
    // Paper defaults normalize the ~30 ad-hoc cards.
    expect(lifeTheme.components.Paper.defaultProps.radius).toBe('md');
    expect(lifeTheme.components.Paper.defaultProps.withBorder).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/Apps/LifeApp.theme.test.js`
Expected: FAIL — cannot resolve `./LifeApp.theme.js`.

- [ ] **Step 3: Write the theme**

```javascript
// frontend/src/Apps/LifeApp.theme.js
import { createTheme } from '@mantine/core';

const fill10 = (hex) => Array(10).fill(hex);

/**
 * Mantine theme for the Life app — a deliberate dark surface matching HealthApp
 * and the household kiosks. Tokens are consumed as `var(--mantine-color-*)`;
 * component defaults normalize the previously ad-hoc cards/typography.
 */
export const lifeTheme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'md',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  colors: {
    background: fill10('#0f1015'),
    surface:    fill10('#191b22'),
    surfaceAlt: fill10('#0b0c10'),
    border:     fill10('#2a2d38'),
    textHigh:   fill10('#e9ecf3'),
    textMid:    fill10('#9aa2b1'),
    textLow:    fill10('#6b7385'),
  },
  headings: {
    sizes: {
      h2: { fontSize: '1.5rem', fontWeight: '650' },   // page titles
      h4: { fontSize: '0.95rem', fontWeight: '600' },  // app brand / section
      h5: { fontSize: '0.85rem', fontWeight: '600' },  // card headings
    },
  },
  components: {
    Paper: { defaultProps: { radius: 'md', withBorder: true, p: 'md', bg: 'surface.0' } },
  },
});

export default lifeTheme;
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/Apps/LifeApp.theme.test.js`
Expected: PASS.

- [ ] **Step 5: Apply the theme in the shell**

In `frontend/src/Apps/LifeApp.jsx`, add the import after line 25:

```javascript
import { lifeTheme } from './LifeApp.theme.js';
```

Change line 85 from:

```javascript
    <MantineProvider>
```

to:

```javascript
    <MantineProvider theme={lifeTheme} defaultColorScheme="dark">
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Apps/LifeApp.theme.js frontend/src/Apps/LifeApp.theme.test.js frontend/src/Apps/LifeApp.jsx
git commit -m "feat(life-ui): dark Mantine theme with card + typography defaults"
```

---

### Task 2: Semantic color module (kills 5 duplicated/conflicting maps)

**Files:**
- Create: `frontend/src/modules/Life/theme/semantics.js`, `frontend/src/modules/Life/theme/semantics.test.jsx`
- Modify (delete local maps, import instead): `widgets/GoalProgressBar.jsx`, `widgets/BeliefConfidenceChip.jsx`, `views/plan/GoalsView.jsx`, `views/plan/GoalDetail.jsx`, `views/plan/BeliefsView.jsx`

**Interfaces:**
- Produces:
  - `goalStateColor(state: string): string` — one map for every goal state.
  - `beliefConfidenceColor(confidence: number): string`
  - `driftStatusColor(status: string): string`
  - `priorityTypeMeta: Record<string, { color, label, icon }>` — used by PriorityList (icon is a Tabler component).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/theme/semantics.test.jsx
import { describe, it, expect } from 'vitest';
import { goalStateColor, beliefConfidenceColor, driftStatusColor, priorityTypeMeta } from './semantics.js';

describe('life semantic colors', () => {
  it('maps every goal state to one stable color', () => {
    expect(goalStateColor('committed')).toBe('green');
    expect(goalStateColor('dream')).toBe('grape');
    expect(goalStateColor('nonsense')).toBe('gray');
  });
  it('bands belief confidence', () => {
    expect(beliefConfidenceColor(0.9)).toBe('green');
    expect(beliefConfidenceColor(0.6)).toBe('yellow');
    expect(beliefConfidenceColor(0.2)).toBe('red');
  });
  it('colors drift status without leaking the enum', () => {
    expect(driftStatusColor('aligned')).toBe('green');
    expect(driftStatusColor('reconsidering')).toBe('red');
    expect(driftStatusColor('insufficient_data')).toBe('gray');
  });
  it('exposes priority metadata for the four alert types plus new ones', () => {
    expect(priorityTypeMeta.ceremony_due.label).toBe('Ritual');
    expect(priorityTypeMeta.drift_alert.color).toBe('yellow');
    expect(priorityTypeMeta.plan_gap).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/theme/semantics.test.jsx`
Expected: FAIL — cannot resolve `./semantics.js`.

- [ ] **Step 3: Write the module**

```javascript
// frontend/src/modules/Life/theme/semantics.js
import {
  IconTarget, IconAlertTriangle, IconTrendingDown, IconBrain,
  IconCalendarEvent, IconSeeding,
} from '@tabler/icons-react';

// One source of truth for goal-state color. Superset of every state the API emits.
const GOAL_STATE_COLORS = {
  dream: 'grape', considered: 'blue', ready: 'cyan', committed: 'green',
  achieved: 'teal', failed: 'red', abandoned: 'dark', paused: 'yellow', evolved: 'violet',
};
export const goalStateColor = (state) => GOAL_STATE_COLORS[state] || 'gray';

export const beliefConfidenceColor = (confidence) => {
  if (confidence >= 0.8) return 'green';
  if (confidence >= 0.5) return 'yellow';
  return 'red';
};

const DRIFT_STATUS_COLORS = {
  aligned: 'green', drifting: 'yellow', reconsidering: 'red', insufficient_data: 'gray',
};
export const driftStatusColor = (status) => DRIFT_STATUS_COLORS[status] || 'gray';

// Priority-card metadata — includes the two new types added backend-side in Phase 3.
export const priorityTypeMeta = {
  goal_deadline:     { icon: IconTarget,          color: 'blue',   label: 'Goal' },
  drift_alert:       { icon: IconTrendingDown,    color: 'yellow', label: 'Drift' },
  anti_goal_warning: { icon: IconAlertTriangle,   color: 'red',    label: 'Warning' },
  dormant_belief:    { icon: IconBrain,           color: 'grape',  label: 'Belief' },
  ceremony_due:      { icon: IconCalendarEvent,   color: 'violet', label: 'Ritual' },
  plan_gap:          { icon: IconSeeding,         color: 'teal',   label: 'Setup' },
};
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/theme/semantics.test.jsx`
Expected: PASS.

- [ ] **Step 5: Replace the duplicated maps with imports**

`widgets/GoalProgressBar.jsx` — delete the `STATE_COLORS` const (lines 3-9) and its use at line 13; import and use:

```jsx
import { Progress, Text, Group, Stack } from '@mantine/core';
import { goalStateColor } from '../theme/semantics.js';

export function GoalProgressBar({ name, state, progress = 0 }) {
  const pct = Math.round(progress * 100);
  const color = goalStateColor(state);
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>{name}</Text>
        <Text size="xs" c="dimmed">{pct}%</Text>
      </Group>
      <Progress value={pct} color={color} size="sm" />
    </Stack>
  );
}
```

`widgets/BeliefConfidenceChip.jsx` — delete the local `confidenceColor` (lines 3-7); `import { beliefConfidenceColor } from '../theme/semantics.js';` and replace the `color={confidenceColor(displayConf)}` prop with `color={beliefConfidenceColor(displayConf)}`.

`views/plan/GoalsView.jsx` — delete the `stateColor` function (lines 17-23); `import { goalStateColor } from '../../theme/semantics.js';` and change line 30's `color={stateColor(goal.state)}` to `color={goalStateColor(goal.state)}`.

`views/plan/GoalDetail.jsx` — delete its local `stateColor` map (the audit cites lines 6-12); import `goalStateColor` the same way and replace each call. (Open the file; it uses the same `stateColor(...)` call shape as GoalsView.)

`views/plan/BeliefsView.jsx` — delete its local `confidenceColor` (audit cites lines 6-10); import `beliefConfidenceColor` and replace calls.

- [ ] **Step 6: Verify nothing else references the deleted maps**

Run: `grep -rn "STATE_COLORS\|const stateColor\|function confidenceColor" frontend/src/modules/Life`
Expected: no matches (all replaced by the shared module).

- [ ] **Step 7: Run the widget/view test files if present, then commit**

Run: `npx vitest run frontend/src/modules/Life/theme/semantics.test.jsx`
Expected: PASS.

```bash
git add frontend/src/modules/Life/theme/ frontend/src/modules/Life/widgets/GoalProgressBar.jsx frontend/src/modules/Life/widgets/BeliefConfidenceChip.jsx frontend/src/modules/Life/views/plan/GoalsView.jsx frontend/src/modules/Life/views/plan/GoalDetail.jsx frontend/src/modules/Life/views/plan/BeliefsView.jsx
git commit -m "feat(life-ui): single semantic-color source; delete conflicting per-view maps"
```

---

### Task 3: Format helpers (no raw ISO dates or internal IDs in the DOM)

**Files:**
- Create: `frontend/src/modules/Life/lib/format.js`, `frontend/src/modules/Life/lib/format.test.jsx`

**Interfaces:**
- Produces:
  - `formatDate(iso: string, opts?): string` — e.g. `"Jul 17, 2026"`; empty string on falsy.
  - `formatDateRange(startIso, endIso): string`
  - `formatPeriodLabel(pos: { alias?, level, periodId }): string` — human label like `"Day · Jul 17"` instead of `"unit: 2026-07-17"`.
  - `humanize(id: string): string` — `"family_time"` → `"Family time"`; used for ref badges.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/lib/format.test.jsx
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateRange, formatPeriodLabel, humanize } from './format.js';

describe('life format helpers', () => {
  it('formats an ISO date to a human month/day/year', () => {
    expect(formatDate('2026-07-17')).toBe('Jul 17, 2026');
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
  });
  it('formats a date range', () => {
    expect(formatDateRange('2026-07-13', '2026-07-19')).toBe('Jul 13 – Jul 19, 2026');
  });
  it('labels a cadence position without leaking the periodId', () => {
    expect(formatPeriodLabel({ level: 'unit', periodId: '2026-07-17' })).toBe('Unit · Jul 17');
    expect(formatPeriodLabel({ alias: 'Day', level: 'unit', periodId: '2026-07-17' })).toBe('Day · Jul 17');
  });
  it('humanizes an internal id', () => {
    expect(humanize('family_time')).toBe('Family time');
    expect(humanize('health')).toBe('Health');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/lib/format.test.jsx`
Expected: FAIL — cannot resolve `./format.js`.

- [ ] **Step 3: Write the module**

```javascript
// frontend/src/modules/Life/lib/format.js
// Parse a 'YYYY-MM-DD' as a LOCAL calendar date (not UTC midnight, which would
// shift the day backward in western timezones).
function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const dt = parseLocal(iso);
  return dt ? dt.toLocaleDateString(undefined, opts) : '';
}

export function formatDateRange(startIso, endIso) {
  const start = parseLocal(startIso);
  const end = parseLocal(endIso);
  if (!start || !end) return formatDate(startIso) || formatDate(endIso) || '';
  const sameYear = start.getFullYear() === end.getFullYear();
  const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const right = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return sameYear ? `${left} – ${right}` : `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

export function formatPeriodLabel({ alias, level, periodId } = {}) {
  const name = alias || (level ? level.charAt(0).toUpperCase() + level.slice(1) : '');
  const when = /^\d{4}-\d{2}-\d{2}/.test(periodId || '')
    ? formatDate(periodId, { month: 'short', day: 'numeric' })
    : (periodId || '');
  return when ? `${name} · ${when}` : name;
}

export function humanize(id) {
  if (!id) return '';
  const s = String(id).replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/lib/format.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/lib/
git commit -m "feat(life-ui): date/period/id format helpers"
```

---

### Task 4: Shared page primitives (LifePage, SectionCard, EmptyState, LoadingState, ErrorState)

**Files:**
- Create: `frontend/src/modules/Life/components/LifePage.jsx`, `SectionCard.jsx`, `EmptyState.jsx`, `LoadingState.jsx`, `ErrorState.jsx`, `index.js`, `components.test.jsx`

**Interfaces:**
- Produces (all named exports, re-exported from `index.js`):
  - `<LifePage title actions?>{children}</LifePage>` — `<Stack gap="md">` with a `<Group justify="space-between">` header (`Title order={2}` + optional actions node).
  - `<SectionCard title? icon? actions?>{children}</SectionCard>` — themed `<Paper>` with an optional `Title order={5}` heading row.
  - `<EmptyState icon message cta?>` — centered icon + dimmed message + optional CTA node.
  - `<LoadingState label?>` — centered `<Loader>` + optional label (replaces the bare top-left spinners).
  - `<ErrorState error onRetry?>` — a Mantine `<Alert color="red">` (replaces raw red text).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/components/components.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { IconSeeding } from '@tabler/icons-react';
import { LifePage, EmptyState, LoadingState, ErrorState, SectionCard } from './index.js';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('Life primitives', () => {
  it('LifePage renders a title and actions', () => {
    wrap(<LifePage title="Goals" actions={<button>Add</button>}>body</LifePage>);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('EmptyState shows message and CTA', () => {
    wrap(<EmptyState icon={IconSeeding} message="No goals yet" cta={<button>Add goal</button>} />);
    expect(screen.getByText('No goals yet')).toBeInTheDocument();
    expect(screen.getByText('Add goal')).toBeInTheDocument();
  });
  it('LoadingState shows an optional label', () => {
    wrap(<LoadingState label="Loading plan" />);
    expect(screen.getByText('Loading plan')).toBeInTheDocument();
  });
  it('ErrorState renders the message and a retry when given', () => {
    let retried = false;
    wrap(<ErrorState error="HTTP 500" onRetry={() => { retried = true; }} />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    screen.getByText(/try again/i).click();
    expect(retried).toBe(true);
  });
  it('SectionCard renders a heading', () => {
    wrap(<SectionCard title="Priorities">inner</SectionCard>);
    expect(screen.getByText('Priorities')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/components/components.test.jsx`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Write the primitives**

```jsx
// frontend/src/modules/Life/components/LifePage.jsx
import { Stack, Group, Title } from '@mantine/core';
export function LifePage({ title, actions, children }) {
  return (
    <Stack gap="md">
      {(title || actions) && (
        <Group justify="space-between" align="center">
          {title ? <Title order={2}>{title}</Title> : <span />}
          {actions}
        </Group>
      )}
      {children}
    </Stack>
  );
}
```

```jsx
// frontend/src/modules/Life/components/SectionCard.jsx
import { Paper, Group, Title } from '@mantine/core';
export function SectionCard({ title, icon: Icon, actions, children, ...rest }) {
  return (
    <Paper {...rest}>
      {(title || actions) && (
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            {Icon && <Icon size={16} />}
            {title && <Title order={5}>{title}</Title>}
          </Group>
          {actions}
        </Group>
      )}
      {children}
    </Paper>
  );
}
```

```jsx
// frontend/src/modules/Life/components/EmptyState.jsx
import { Paper, Stack, Text, ThemeIcon } from '@mantine/core';
export function EmptyState({ icon: Icon, message, cta }) {
  return (
    <Paper p="xl">
      <Stack gap="sm" align="center">
        {Icon && <ThemeIcon variant="light" size={48} radius="xl" color="gray"><Icon size={26} /></ThemeIcon>}
        <Text c="dimmed" ta="center" maw={420}>{message}</Text>
        {cta}
      </Stack>
    </Paper>
  );
}
```

```jsx
// frontend/src/modules/Life/components/LoadingState.jsx
import { Center, Stack, Loader, Text } from '@mantine/core';
export function LoadingState({ label }) {
  return (
    <Center mih={160}>
      <Stack gap="xs" align="center">
        <Loader size="md" />
        {label && <Text size="sm" c="dimmed">{label}</Text>}
      </Stack>
    </Center>
  );
}
```

```jsx
// frontend/src/modules/Life/components/ErrorState.jsx
import { Alert, Button, Group } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
export function ErrorState({ error, onRetry }) {
  return (
    <Alert color="red" title="Something went wrong" icon={<IconAlertCircle size={16} />}>
      {typeof error === 'string' ? error : (error?.message || 'Unexpected error')}
      {onRetry && (
        <Group mt="sm">
          <Button size="xs" variant="light" color="red" onClick={onRetry}>Try again</Button>
        </Group>
      )}
    </Alert>
  );
}
```

```javascript
// frontend/src/modules/Life/components/index.js
export { LifePage } from './LifePage.jsx';
export { SectionCard } from './SectionCard.jsx';
export { EmptyState } from './EmptyState.jsx';
export { LoadingState } from './LoadingState.jsx';
export { ErrorState } from './ErrorState.jsx';
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/components/components.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/components/
git commit -m "feat(life-ui): shared page/section/empty/loading/error primitives"
```

---

### Task 5: Fix the ActivityHeatmap visual defect

**Files:**
- Modify: `frontend/src/modules/Life/views/log/shared/ActivityHeatmap.jsx`
- Test: `frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx`

**Problem (audit S1):** zero-count days render `var(--mantine-color-dark-6)` (near-black) — invisible-wrong on a dark theme too (blends into the surface) and was designed for light. The SVG is fixed-width with no overflow container (~744px on year view → horizontal body scroll), and it mounts one Mantine `Tooltip` portal per day (~365 on the year view).

**Interfaces:**
- Produces: `export function getHeatColor(count, max): string` (extracted, testable) and an unchanged `<ActivityHeatmap days countFn>` whose SVG is wrapped in a horizontal `ScrollArea` and uses a native `<title>` per cell.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ActivityHeatmap, getHeatColor } from './ActivityHeatmap.jsx';

describe('ActivityHeatmap', () => {
  it('uses a subtle surface color for empty days, not near-black dark-6', () => {
    expect(getHeatColor(0, 10)).toBe('var(--mantine-color-dark-4)');
    expect(getHeatColor(10, 10)).toBe('var(--mantine-color-green-6)');
  });
  it('renders a native <title> per in-range cell (no Tooltip portal storm)', () => {
    const days = { '2026-07-13': { sources: { a: 1 } }, '2026-07-14': { sources: {} } };
    const { container } = render(
      <MantineProvider><ActivityHeatmap days={days} /></MantineProvider>
    );
    expect(container.querySelectorAll('svg title').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx`
Expected: FAIL — `getHeatColor` is not exported; empty color is `dark-6`.

- [ ] **Step 3: Edit the component**

Replace the `getColor` function (lines 8-15) with an exported, dark-appropriate version and rename its call site:

```jsx
export function getHeatColor(count, max) {
  if (count === 0) return 'var(--mantine-color-dark-4)';
  const ratio = max ? count / max : 0;
  if (ratio > 0.75) return 'var(--mantine-color-green-6)';
  if (ratio > 0.5) return 'var(--mantine-color-green-5)';
  if (ratio > 0.25) return 'var(--mantine-color-green-4)';
  return 'var(--mantine-color-green-3)';
}
```

Change the import line 2 to add `ScrollArea` and drop `Tooltip`:

```jsx
import { Stack, Text, ScrollArea } from '@mantine/core';
```

Replace the render `return` (lines 63-89) — wrap the SVG in `ScrollArea` and swap per-cell `Tooltip` for a native `<title>`:

```jsx
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
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/views/log/shared/ActivityHeatmap.jsx frontend/src/modules/Life/views/log/shared/ActivityHeatmap.test.jsx
git commit -m "fix(life-ui): heatmap empty-cell color, overflow scroll, native title tooltips"
```

---

### Task 6: AppShell chrome — collapsible navbar, reconciled heights, scss hook

**Files:**
- Modify: `frontend/src/Apps/LifeApp.jsx` (Burger + collapse state, header brand size), `frontend/src/modules/Life/views/coach/CoachChat.jsx:21` (height uses the app-shell CSS var)
- Create: `frontend/src/Apps/LifeApp.scss` + import it in `LifeApp.jsx`

**Problem (audit S1):** `navbar={{ width: 200, breakpoint: 'sm' }}` has no `collapsed` state and no Burger, so below `sm` the navbar covers content with no way past it; and `CoachChat` sizes with a magic `calc(100vh - 60px)` that disagrees with the header height 48.

- [ ] **Step 1: Add mobile-nav state and Burger to LifeApp.jsx**

Add to the imports at line 2 (`useDisclosure`) and line 2's Mantine import (`Burger`):

```jsx
import { MantineProvider, AppShell, NavLink, Title, Group, Text, Select, Burger } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
```

Inside `LifeApp`, after `const location = useLocation();` (line 59) add:

```jsx
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
```

Change the `navbar` prop (line 90) to declare the collapse behavior:

```jsx
        navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
```

In `<AppShell.Header>`'s `<Group>` (line 94), add the Burger as the first child:

```jsx
          <Group gap="sm">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <Title order={4}>Life</Title>
          </Group>
```

(Keep the existing `Select` as the second child; ensure the outer `<Group ... justify="space-between">` now wraps these two groups.)

- [ ] **Step 2: Close the nav after navigation**

For each `onClick={() => navigate('/life/…')}` in the navbar (lines 116–141), also close the mobile nav. Wrap the handler, e.g.:

```jsx
            onClick={() => { navigate('/life/now'); closeNav(); }}
```

Apply the same `; closeNav()` to every navbar `navigate(...)` onClick.

- [ ] **Step 3: Reconcile the CoachChat height**

In `frontend/src/modules/Life/views/coach/CoachChat.jsx:21`, replace `style={{ height: 'calc(100vh - 60px)' }}` with the AppShell-aware var:

```jsx
      style={{ height: 'calc(100vh - var(--app-shell-header-height, 48px) - var(--app-shell-padding, 16px) * 2)' }}
```

- [ ] **Step 4: Add the scss hook and import it**

```scss
// frontend/src/Apps/LifeApp.scss
.life-clickable { cursor: pointer; }
// Kiosk-distance density bump: base text one notch larger on wide displays.
@media (min-width: 1280px) {
  .life-app-root { font-size: 1.02rem; }
}
```

Add `import './LifeApp.scss';` after line 7 in `LifeApp.jsx`, and add `className="life-app-root"` to `<AppShell.Main>` (line 145).

- [ ] **Step 5: Verify the app still builds/renders**

Run: `npx vitest run frontend/src/Apps/LifeApp.theme.test.js`
Expected: PASS (regression guard — theme still imports cleanly). Then a quick manual smoke: `grep -n "Burger\|collapsed\|closeNav" frontend/src/Apps/LifeApp.jsx` shows the wiring present.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Apps/LifeApp.jsx frontend/src/Apps/LifeApp.scss frontend/src/modules/Life/views/coach/CoachChat.jsx
git commit -m "fix(life-ui): collapsible mobile navbar, reconciled chrome heights, scss hook"
```

---

## Phase 2 — Sweep the views onto the design system

> Each task below converts a cluster of views to `LifePage`/`SectionCard`/`EmptyState`/`LoadingState`/`ErrorState` + `format`/`semantics`, fixing the per-file loading/error/raw-ID findings. These are refactors guarded by a light render test per cluster (the views' behavior is unchanged; the test asserts the new primitives appear and no raw ISO/`HTTP` strings leak).

### Task 7: Log views — loading/error/format sweep

**Files:**
- Modify: `views/log/LogDayDetail.jsx`, `LogWeekView.jsx`, `LogMonthView.jsx`, `LogSeasonView.jsx`, `LogYearView.jsx`, `LogDecadeView.jsx`, `LogCategoryView.jsx`, `LogTimeline.jsx`
- Test: `views/log/LogWeekView.test.jsx` (representative)

**Pattern applied to every file in the cluster:**
1. Replace `if (loading) return <Loader size="sm" />;` (and `if (loading) return null;`) with `if (loading) return <LoadingState />;`
2. Replace `if (error) return <Text c="red" size="sm">{error}</Text>;` with `if (error) return <ErrorState error={error} onRetry={refetch} />;` (each Log hook already returns `refetch`).
3. Replace raw ISO date headings/labels with `formatDate(...)` / `formatDateRange(...)` (e.g. `LogDayDetail` title `{date}` → `{formatDate(date)}`; `LogMonthView` "Week of {weekStart}" → `` `Week of ${formatDate(weekStart)}` ``; `LogSeasonView` card title `{monthId}` → `{formatDate(monthId + '-01', { month: 'long', year: 'numeric' })}`).
4. Wrap each view body in `<LifePage title={…}>` where it currently hand-rolls a `<Stack>` + `<Title order={4}>`.

- [ ] **Step 1: Write the representative failing test**

```jsx
// frontend/src/modules/Life/views/log/LogWeekView.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../../hooks/useLifelog.js', () => ({
  useLifelogWeek: () => ({ loading: false, error: null, refetch: vi.fn(), week: { days: {} }, days: {} }),
}));
import { LogWeekView } from './LogWeekView.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
beforeEach(() => {});

describe('LogWeekView', () => {
  it('shows a human date range, not a raw ISO string', () => {
    wrap(<LogWeekView weekStart="2026-07-13" />);
    // The heading must not contain a raw ISO date.
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
```

> Note: check the actual hook name/shape in `LogWeekView.jsx` before finalizing the `vi.mock` (the file imports its data hook from `../../hooks/useLifelog.js`). Adjust the mocked export name and props to match what the component destructures.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/log/LogWeekView.test.jsx`
Expected: FAIL — raw `2026-07-13` still rendered (and/or import shape mismatch to fix first).

- [ ] **Step 3: Apply the 4-point pattern to LogWeekView.jsx**

Import at top: `import { LifePage, LoadingState, ErrorState } from '../../components/index.js';` and `import { formatDate, formatDateRange } from '../../lib/format.js';`. Replace the loading/error guards and the raw `{weekStart}` heading with `formatDateRange(weekStart, weekEnd)` (compute `weekEnd` = start + 6 days, or use the range already present in the week payload). Wrap the body in `<LifePage title={`Week of ${formatDate(weekStart)}`}>`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/log/LogWeekView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Apply the same 4-point pattern to the other 7 log files**

For each of `LogDayDetail.jsx`, `LogMonthView.jsx`, `LogSeasonView.jsx`, `LogYearView.jsx`, `LogDecadeView.jsx`, `LogCategoryView.jsx`, `LogTimeline.jsx`: add the same two imports; replace loading (`<Loader size="sm"/>`/`return null`) → `<LoadingState/>`; error (`<Text c="red">`) → `<ErrorState error={error} onRetry={refetch}/>`; wrap raw ISO/`{monthId}`/`{date}` in `formatDate`/`formatDateRange`; and title via `<LifePage>`.

- [ ] **Step 6: Verify no raw ISO or `HTTP` strings remain in the log cluster**

Run: `grep -rnE '\{date\}|\{weekStart\}|\{monthId\}|c="red"|Loader size="sm"' frontend/src/modules/Life/views/log`
Expected: no matches for `c="red"` / `Loader size="sm"`; any remaining `{date}`-style tokens must be wrapped by a `formatDate(...)` call (inspect each hit).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Life/views/log/
git commit -m "feat(life-ui): log views use shared loading/error/empty + human dates"
```

---

### Task 8: Plan views — primitives + empty-state funnels + format

**Files:**
- Modify: `views/plan/PurposeView.jsx`, `GoalsView.jsx`, `GoalDetail.jsx`, `BeliefsView.jsx`, `ValuesView.jsx`, `QualitiesView.jsx`, `CeremonyConfig.jsx`
- Test: `views/plan/QualitiesView.test.jsx` (representative — it's currently a dead-end empty state)

**Pattern:**
1. `if (loading) return null;` → `if (loading) return <LoadingState />;`
2. Hand-rolled `<Stack><Group><Title order={4}>…` headers → `<LifePage title=… actions=…>`.
3. Ref/ID badges that print raw ids (`PurposeView` grounded-in `{ref}`, `QualitiesView` grounded-in, `GoalDetail` `{d.type}: {d.target_id}`) → `humanize(ref)` / `formatDate`.
4. Dead-end empty states (`QualitiesView` "No qualities defined yet.", `PurposeView` "No purpose statement defined yet.") → `<EmptyState icon message cta={<Button onClick={() => navigate('/life/coach')}>Talk to your coach</Button>} />` (the coach can author these; see Phase 5). Note: PurposeView's real create path is fixed in Task 12 — here it just gets the funnel + LoadingState.

- [ ] **Step 1: Write the representative failing test**

```jsx
// frontend/src/modules/Life/views/plan/QualitiesView.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useLifePlan.js', () => ({
  useLifePlan: () => ({ plan: { qualities: [] }, loading: false, error: null }),
}));
import { QualitiesView } from './QualitiesView.jsx';

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);

describe('QualitiesView empty state', () => {
  it('offers a coach path instead of dead-ending', () => {
    wrap(<QualitiesView />);
    expect(screen.getByText(/talk to your coach/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/plan/QualitiesView.test.jsx`
Expected: FAIL — no coach CTA in the empty state.

- [ ] **Step 3: Update QualitiesView.jsx**

Add imports: `import { useNavigate } from 'react-router-dom';`, `import { LifePage, LoadingState, EmptyState } from '../../components/index.js';`, `import { IconShield } from '@tabler/icons-react';`. Replace `if (loading) return null;` with `<LoadingState/>`. Replace the "No qualities defined yet." block with:

```jsx
  if (!qualities.length) {
    return (
      <LifePage title="Qualities">
        <EmptyState
          icon={IconShield}
          message="Qualities are the character traits you want to embody. Your coach can help you name your first few."
          cta={<Button onClick={() => navigate('/life/coach')}>Talk to your coach</Button>}
        />
      </LifePage>
    );
  }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/plan/QualitiesView.test.jsx`
Expected: PASS.

- [ ] **Step 5: Apply the pattern to the remaining plan views**

`PurposeView.jsx`, `GoalsView.jsx`, `GoalDetail.jsx`, `BeliefsView.jsx`, `ValuesView.jsx`, `CeremonyConfig.jsx`: swap loading guards to `<LoadingState/>`; wrap headers in `<LifePage>`; run raw ids through `humanize`/`formatDate`; give Purpose the coach-funnel `EmptyState` (its true create path lands in Task 12). GoalsView/ValuesView/BeliefsView already have create modals — keep them, just move their header into `LifePage actions`.

- [ ] **Step 6: Verify raw-id leaks are gone in the plan cluster**

Run: `grep -rnE '\{ref\}|\{d\.type\}|target_id|Loader size="sm"|return null;' frontend/src/modules/Life/views/plan`
Expected: `Loader size="sm"` gone; each `return null` on loading replaced; remaining `{ref}` wrapped by `humanize(...)`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Life/views/plan/
git commit -m "feat(life-ui): plan views on shared primitives; coach funnels replace dead ends"
```

---

### Task 9: Now/ceremony views — primitives + CadenceIndicator relabel

**Files:**
- Modify: `views/now/Dashboard.jsx`, `views/ceremony/CeremonyFlow.jsx`, `UnitCapture.jsx`, `UnitIntention.jsx`, `CycleRetro.jsx`, `widgets/CadenceIndicator.jsx`, `widgets/ValueAllocationChart.jsx`
- Test: `widgets/CadenceIndicator.test.jsx`

**Pattern:** Dashboard loading → `<LoadingState/>`; the planless card becomes an `EmptyState`/`SectionCard`; `CadenceIndicator` uses `formatPeriodLabel` instead of `{pos.periodId}`; `ValueAllocationChart` colors bars by a stable value-id hash (not sort index); ceremony views swap `Loader`/raw-red for the primitives.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/widgets/CadenceIndicator.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CadenceIndicator } from './CadenceIndicator.jsx';

describe('CadenceIndicator', () => {
  it('shows a human period label, not the raw periodId', () => {
    const { container } = render(
      <MantineProvider>
        <CadenceIndicator cadencePosition={{ unit: { level: 'unit', periodId: '2026-07-17' } }} />
      </MantineProvider>
    );
    expect(container.textContent).toContain('Jul 17');
    expect(container.textContent).not.toContain('2026-07-17');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/widgets/CadenceIndicator.test.jsx`
Expected: FAIL — raw `2026-07-17` rendered.

- [ ] **Step 3: Update CadenceIndicator.jsx**

```jsx
import { Group, Badge } from '@mantine/core';
import { formatPeriodLabel } from '../lib/format.js';

export function CadenceIndicator({ cadencePosition }) {
  if (!cadencePosition) return null;
  return (
    <Group gap="xs">
      {['unit', 'cycle', 'phase', 'season', 'era'].map(level => {
        const pos = cadencePosition[level];
        if (!pos) return null;
        return (
          <Badge key={level} variant="light" size="sm" color="violet">
            {formatPeriodLabel({ ...pos, level })}
          </Badge>
        );
      })}
    </Group>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/widgets/CadenceIndicator.test.jsx`
Expected: PASS.

- [ ] **Step 5: Apply the primitive/format swaps to the now + ceremony views**

Dashboard: `<Loader size="sm"/>` → `<LoadingState/>`; wrap the planless card content unchanged but inside a `SectionCard`. Ceremony views: `Loader`/raw-red → `<LoadingState/>`/`<ErrorState/>`. `ValueAllocationChart.jsx`: replace `COLORS[i % 8]` with a stable pick keyed on the value id (`COLORS[hashStr(valueId) % COLORS.length]`, where `hashStr` sums char codes) so a bar keeps its color across re-ranks; label bars with `humanize(valueId)`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Life/views/now/ frontend/src/modules/Life/views/ceremony/ frontend/src/modules/Life/widgets/
git commit -m "feat(life-ui): now/ceremony views + cadence/allocation widgets on the design system"
```

---

## Phase 3 — Backend usability: genesis, honest alerts, lifecycle model

> Backend layer facts (verified): `AlignmentService` already receives `cadenceService` + `ceremonyRecordStore`. `PlanAuthoringService.setPurpose(username, { statement })` already exists (create-or-update). The plan router resolves username via `getUsername(req) = req.lifeUsername || req.query.username || 'default'`. Composition root is `backend/src/5_composition/modules/lifeplan.mjs`. Backend tests are vitest under `tests/isolated/…` with `#apps/#domains` import aliases; run one with `npx vitest run <file>`.

### Task 10: `POST /purpose` route (unblocks planless purpose authoring)

**Files:**
- Modify: `backend/src/4_api/v1/routers/life/plan.mjs` (add route near the `POST /values` handler at `:46`)
- Test: `tests/isolated/api/routers/life-purpose-authoring.test.mjs`

**Interfaces:**
- Produces: `POST /api/v1/life/plan/purpose` accepting `{ statement }`, returning `201` + the purpose JSON. Uses the already-injected `planAuthoringService.setPurpose`.

- [ ] **Step 1: Write the failing test** (mirror `life-plan-authoring.test.mjs`'s app-mount pattern)

```javascript
// tests/isolated/api/routers/life-purpose-authoring.test.mjs
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import createLifeRouter from '#api/v1/routers/life/index.mjs';
import { PlanAuthoringService } from '#apps/lifeplan/services/PlanAuthoringService.mjs';

function buildApp() {
  const plans = new Map();
  const lifePlanStore = {
    load: (u) => plans.get(u) || null,
    save: (u, p) => { plans.set(u, p); },
  };
  const planAuthoringService = new PlanAuthoringService({ lifePlanStore });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/life', createLifeRouter({
    lifePlanStore, planAuthoringService,
    goalStateService: {}, beliefEvaluator: {}, cadenceService: {},
    ceremonyService: {}, feedbackService: {}, retroService: {},
    alignmentService: {}, driftService: {}, aggregator: {},
    defaultUsername: 'test-user',
  }));
  return app;
}

describe('POST /life/plan/purpose', () => {
  let app;
  beforeEach(() => { app = buildApp(); });

  it('creates a purpose for a planless user (no 404)', async () => {
    const res = await request(app)
      .post('/api/v1/life/plan/purpose')
      .send({ statement: 'To build things my kids are proud of.' });
    expect(res.status).toBe(201);
    expect(res.body.statement).toBe('To build things my kids are proud of.');
  });

  it('400s when statement is missing', async () => {
    const res = await request(app).post('/api/v1/life/plan/purpose').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/api/routers/life-purpose-authoring.test.mjs`
Expected: FAIL — 404 (no such route; falls through to `PATCH`-less POST → 404).

- [ ] **Step 3: Add the route** in `backend/src/4_api/v1/routers/life/plan.mjs`, immediately after the `POST /values` handler (after line 57):

```javascript
  router.post('/purpose', (req, res, next) => {
    try {
      if (!planAuthoringService) return res.status(501).json({ error: 'Plan authoring service not configured' });
      const { statement } = req.body || {};
      if (!statement) return res.status(400).json({ error: 'statement is required' });
      const username = getUsername(req);
      const purpose = planAuthoringService.setPurpose(username, { statement });
      logger.info('life.purpose.set', { username });
      res.status(201).json(purpose);
    } catch (error) { next(error); }
  });
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/api/routers/life-purpose-authoring.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/life/plan.mjs tests/isolated/api/routers/life-purpose-authoring.test.mjs
git commit -m "feat(lifeplan): POST /plan/purpose creates-or-updates the purpose (planless-safe)"
```

---

### Task 11: Gate drift status against tiny samples (kills chronic false "reconsidering")

**Files:**
- Modify: `backend/src/2_domains/lifeplan/services/ValueDriftCalculator.mjs` (the `calculateDrift` band logic at `:66-92`)
- Test: `tests/isolated/domain/lifeplan/value-drift-sample-gate.test.mjs`

**Problem (audit S1):** with 2–3 common values, Spearman only yields ±1 / ±0.5, so one flipped pair → `reconsidering` → permanent high-urgency alert. Require a minimum number of shared (stated ∩ observed) values before emitting any status stronger than `insufficient_data`.

**Interfaces:**
- Produces: a module const `MIN_COMMON_VALUES = 4` and a gate in `calculateDrift` that returns `status: 'insufficient_data'` when the stated∩observed intersection is smaller than it.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/lifeplan/value-drift-sample-gate.test.mjs
import { describe, it, expect } from 'vitest';
import { ValueDriftCalculator } from '#domains/lifeplan/services/ValueDriftCalculator.mjs';

const calc = new ValueDriftCalculator();
const values = (ids) => ids.map((id, i) => ({ id, rank: i + 1 }));

describe('ValueDriftCalculator small-sample gate', () => {
  it('returns insufficient_data with only 3 common values, even if anti-correlated', () => {
    const allocation = { a: 1, b: 2, c: 3 };            // observed order c,b,a
    const res = calc.calculateDrift(allocation, values(['a', 'b', 'c'])); // stated a,b,c
    expect(res.status).toBe('insufficient_data');
  });

  it('emits a real status once >= 4 common values exist', () => {
    const allocation = { a: 4, b: 3, c: 2, d: 1 };       // observed a,b,c,d
    const res = calc.calculateDrift(allocation, values(['a', 'b', 'c', 'd'])); // perfectly aligned
    expect(res.status).toBe('aligned');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/domain/lifeplan/value-drift-sample-gate.test.mjs`
Expected: FAIL — 3-common case returns `reconsidering`, not `insufficient_data`.

- [ ] **Step 3: Add the gate** in `ValueDriftCalculator.mjs`. Near the top add the constant:

```javascript
export const MIN_COMMON_VALUES = 4;
```

In `calculateDrift`, after `const observedOrder = …` and before computing `correlation`, compute the intersection and gate:

```javascript
    const common = statedOrder.filter((id) => observedOrder.includes(id));
    if (common.length < MIN_COMMON_VALUES) {
      return { correlation: null, status: 'insufficient_data', statedOrder, observedOrder, allocation };
    }
```

(Leave the existing `correlation === null` guard and band mapping below it unchanged.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/domain/lifeplan/value-drift-sample-gate.test.mjs`
Expected: PASS. Then run the existing drift suite to confirm no regression: `npx vitest run tests/isolated/domain/lifeplan/value-drift.test.mjs` (update any now-stale small-sample assertions there to expect `insufficient_data`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/lifeplan/services/ValueDriftCalculator.mjs tests/isolated/domain/lifeplan/value-drift-sample-gate.test.mjs
git commit -m "fix(lifeplan): require >=4 common values before a drift status (no tiny-sample false alarms)"
```

---

### Task 12: Suppress the latched anti-goal warning (uncomputed static field)

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/AlignmentService.mjs` (remove the `anti_goal_warning` branch at `:91-101`)
- Test: `tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs`

**Problem (audit S1):** `AntiGoal.proximity` is a static stored string (default `'distant'`) that nothing computes; the alert only fires on `approaching`/`imminent`, so if ever hand-set it latches a critical alarm forever with no clear path. Suppress the priority until proximity is actually computed (keep the entity/data intact).

- [ ] **Step 1: Write the failing test** (construct AlignmentService with in-memory stores per `alignment-engine.test.mjs`)

```javascript
// tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs
import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svcWithPlan(plan) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => ({}) },
    cadenceService: { resolve: () => ({}) },
    ceremonyRecordStore: { getRecords: () => [] },
    clock,
  });
}

describe('AlignmentService anti-goal suppression', () => {
  it('does NOT emit an anti_goal_warning even when proximity is imminent', () => {
    const plan = {
      anti_goals: [{ nightmare: 'Estranged from my kids', proximity: 'imminent' }],
      beliefs: [], values: [], feedback: [],
      getActiveGoals: () => [], toJSON: () => ({}),
    };
    const result = svcWithPlan(plan).computeAlignment('test-user');
    expect(result.priorities.some((p) => p.type === 'anti_goal_warning')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs`
Expected: FAIL — an `anti_goal_warning` priority is emitted.

- [ ] **Step 3: Remove the branch** in `AlignmentService.mjs` `#computePriorities` (lines ~91-101). Delete the entire `for (const ag of plan.anti_goals || [])` block that pushes `anti_goal_warning`, and replace it with a comment:

```javascript
    // anti_goal_warning intentionally suppressed: AntiGoal.proximity is a static,
    // never-computed field (default 'distant'); firing off it latches a critical
    // alarm with no clearing path. Re-enable once NightmareProximityService computes
    // proximity on a schedule. See 2026-07-17 UX audit §4.
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/AlignmentService.mjs tests/isolated/lifeplan/services/alignment-anti-goal.test.mjs
git commit -m "fix(lifeplan): suppress latched anti-goal warning until proximity is computed"
```

---

### Task 13: Human-readable drift alert (name the value + the gap)

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/AlignmentService.mjs` (the `drift_alert` branch at `:106-114`, add a `#mostDriftedValue` helper)
- Test: `tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs`

**Problem (audit S1):** the alert reads `"Value drift detected (reconsidering)"` / `"Correlation: 0.42"` — internal enum + coefficient. Rewrite it to name the most-drifted value and the concrete gap, using `snapshot.statedOrder`/`observedOrder` (already on the drift snapshot).

**Interfaces:**
- Produces: `#mostDriftedValue(plan, snapshot) → { name, statedRank, observedRank } | null` and a rewritten drift priority whose `title`/`reason` contain no enum/coefficient.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs
import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svc(plan, snapshot) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => snapshot },
    cadenceService: { resolve: () => ({}) },
    ceremonyRecordStore: { getRecords: () => [] },
    clock,
  });
}

describe('drift alert copy', () => {
  it('names the value and the gap, not the enum/coefficient', () => {
    const plan = {
      values: [{ id: 'family', name: 'Family', rank: 1 }, { id: 'craft', name: 'Craft', rank: 2 },
               { id: 'health', name: 'Health', rank: 3 }, { id: 'wealth', name: 'Wealth', rank: 4 }],
      beliefs: [], anti_goals: [], feedback: [], getActiveGoals: () => [], toJSON: () => ({}),
    };
    const snapshot = {
      correlation: 0.2, status: 'reconsidering',
      statedOrder: ['family', 'craft', 'health', 'wealth'],
      observedOrder: ['wealth', 'health', 'craft', 'family'],
    };
    const alert = svc(plan, snapshot).computeAlignment('u').priorities.find((p) => p.type === 'drift_alert');
    expect(alert).toBeTruthy();
    expect(alert.title).toContain('Family');
    expect(alert.title + alert.reason).not.toMatch(/reconsidering|correlation|0\.\d/i);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs`
Expected: FAIL — title is `"Value drift detected (reconsidering)"`.

- [ ] **Step 3: Add the helper + rewrite the branch** in `AlignmentService.mjs`.

Add a private method:

```javascript
  #mostDriftedValue(plan, snapshot) {
    const stated = snapshot.statedOrder || [];
    const observed = snapshot.observedOrder || [];
    let worst = null;
    for (const id of stated) {
      const s = stated.indexOf(id);
      const o = observed.indexOf(id);
      if (o < 0) continue;
      const drop = o - s;
      if (!worst || drop > worst.drop) {
        const value = (plan.values || []).find((v) => v.id === id);
        worst = { name: value?.name || id, statedRank: s + 1, observedRank: o + 1, drop };
      }
    }
    return worst && worst.drop > 0 ? worst : null;
  }
```

Replace the `drift_alert` push (lines ~106-114) with:

```javascript
    if (snapshot.status === 'drifting' || snapshot.status === 'reconsidering') {
      const v = this.#mostDriftedValue(plan, snapshot);
      items.push({
        type: 'drift_alert',
        title: v ? `${v.name} matters to you, but it's getting little of your time`
                 : `Your time and your values are pulling apart`,
        reason: v ? `You rank it #${v.statedRank}, but it lands #${v.observedRank} in where your time actually goes`
                  : `Recent activity doesn't match your stated priorities`,
        urgency: snapshot.status === 'reconsidering' ? 'high' : 'medium',
        related_value: v ? (plan.values || []).find((x) => x.name === v.name)?.id ?? null : null,
      });
    }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/AlignmentService.mjs tests/isolated/lifeplan/services/alignment-drift-copy.test.mjs
git commit -m "feat(lifeplan): drift alert names the value and the time gap, not the coefficient"
```

---

### Task 14: `CeremonyDueResolver` domain service (one SSOT for ceremony dueness)

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/CeremonyDueResolver.mjs`
- Test: `tests/isolated/domain/lifeplan/ceremony-due-resolver.test.mjs`
- Modify: `backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs` (import the shared constants instead of its local copies)

**Interfaces:**
- Produces:
  - Exported consts `CEREMONY_TIMING`, `CEREMONY_CADENCE_MAP`, `DEFAULT_ENABLED`, `CEREMONY_TITLES`.
  - `class CeremonyDueResolver` with `constructor({ cadenceService })` and `listDue({ plan, cadencePosition, cadenceConfig, today, hasRecord }) → Array<{ type, timing, periodId, title }>` (no time-of-day gate — returns everything due *today*).
- Consumes: `cadenceService.isCeremonyDue(timing, cadenceConfig, today, lastDate)` (domain method, `CadenceService.mjs:80`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/lifeplan/ceremony-due-resolver.test.mjs
import { describe, it, expect } from 'vitest';
import { CeremonyDueResolver } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';

const cadenceService = { isCeremonyDue: (timing) => timing === 'start_of_unit' };

describe('CeremonyDueResolver.listDue', () => {
  const plan = { ceremonies: {} };
  const cadencePosition = { unit: { periodId: '2026-07-17' }, cycle: { periodId: '2026-W29' } };

  it('lists a default-enabled ceremony that is due and not yet recorded', () => {
    const due = new CeremonyDueResolver({ cadenceService }).listDue({
      plan, cadencePosition, cadenceConfig: {}, today: '2026-07-17', hasRecord: () => false,
    });
    expect(due.map((d) => d.type)).toContain('unit_intention');
    expect(due.find((d) => d.type === 'unit_intention').title).toBe('Set your intention');
  });

  it('excludes a ceremony already recorded this period', () => {
    const due = new CeremonyDueResolver({ cadenceService }).listDue({
      plan, cadencePosition, cadenceConfig: {}, today: '2026-07-17',
      hasRecord: (type) => type === 'unit_intention',
    });
    expect(due.map((d) => d.type)).not.toContain('unit_intention');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/domain/lifeplan/ceremony-due-resolver.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the resolver**

```javascript
// backend/src/2_domains/lifeplan/services/CeremonyDueResolver.mjs
export const CEREMONY_TIMING = {
  unit_intention: 'start_of_unit',
  unit_capture: 'end_of_unit',
  cycle_retro: 'end_of_cycle',
  phase_review: 'end_of_phase',
  season_alignment: 'end_of_season',
  era_vision: 'end_of_era',
};

export const CEREMONY_CADENCE_MAP = {
  unit_intention: 'unit', unit_capture: 'unit', cycle_retro: 'cycle',
  phase_review: 'phase', season_alignment: 'season', era_vision: 'era',
};

export const DEFAULT_ENABLED = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review'];

export const CEREMONY_TITLES = {
  unit_intention: 'Set your intention',
  unit_capture: 'Capture your day',
  cycle_retro: 'Weekly retro',
  phase_review: 'Phase review',
  season_alignment: 'Season alignment',
  era_vision: 'Era vision',
};

/**
 * Resolves which ceremonies are due *today* for a plan — the SSOT shared by the
 * dashboard (AlignmentService, no time-of-day gate) and the nudge sender
 * (CeremonyScheduler, which additionally hour-gates).
 */
export class CeremonyDueResolver {
  #cadenceService;
  constructor({ cadenceService }) { this.#cadenceService = cadenceService; }

  listDue({ plan, cadencePosition, cadenceConfig, today, hasRecord }) {
    const due = [];
    for (const [type, timing] of Object.entries(CEREMONY_TIMING)) {
      const cfg = plan?.ceremonies?.[type];
      const enabled = cfg?.enabled ?? DEFAULT_ENABLED.includes(type);
      if (!enabled) continue;
      const periodId = cadencePosition?.[CEREMONY_CADENCE_MAP[type]]?.periodId;
      if (!periodId) continue;
      if (hasRecord(type, periodId)) continue;
      if (!this.#cadenceService.isCeremonyDue(timing, cadenceConfig, today, null)) continue;
      due.push({ type, timing, periodId, title: CEREMONY_TITLES[type] || type });
    }
    return due;
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/domain/lifeplan/ceremony-due-resolver.test.mjs`
Expected: PASS.

- [ ] **Step 5: Point CeremonyScheduler at the shared constants**

In `CeremonyScheduler.mjs`, delete its local `CEREMONY_TIMING`, `CEREMONY_CADENCE_MAP`, `DEFAULT_ENABLED` declarations and import them instead:

```javascript
import { CEREMONY_TIMING, CEREMONY_CADENCE_MAP, DEFAULT_ENABLED } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';
```

(Leave `CEREMONY_TITLES` local in the scheduler untouched if its copy differs — the scheduler's user-facing nudge titles can stay; the resolver's are for the dashboard. Or import `CEREMONY_TITLES` too and delete the local. Keep the scheduler's existing per-type nudge behavior otherwise unchanged.)

- [ ] **Step 6: Verify the scheduler still passes its suite**

Run: `npx vitest run tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs`
Expected: PASS (no behavior change — constants relocated).

- [ ] **Step 7: Commit**

```bash
git add backend/src/2_domains/lifeplan/services/CeremonyDueResolver.mjs backend/src/3_applications/lifeplan/services/CeremonyScheduler.mjs tests/isolated/domain/lifeplan/ceremony-due-resolver.test.mjs
git commit -m "feat(lifeplan): CeremonyDueResolver SSOT for ceremony dueness"
```

---

### Task 15: AlignmentService emits `ceremony_due` + `plan_gap` priorities and a `stage`/`completeness` model

**Files:**
- Modify: `backend/src/3_applications/lifeplan/services/AlignmentService.mjs` (`computeAlignment`, `#computePriorities`, add `#computeStage`), and inject `ceremonyDueResolver`
- Modify: `backend/src/5_composition/modules/lifeplan.mjs` (construct + inject `CeremonyDueResolver` into `AlignmentService`)
- Test: `tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs`

**Interfaces:**
- Consumes: `ceremonyDueResolver.listDue({...})` (Task 14).
- Produces: `computeAlignment` result gains `dashboard.stage` (`'scaffolding' | 'active'`) and `dashboard.completeness` (`{ hasPurpose, valueCount, goalCount, beliefCount }`); `priorities` may contain `ceremony_due` (one per due ceremony) and `plan_gap` items.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs
import { describe, it, expect } from 'vitest';
import { AlignmentService } from '#apps/lifeplan/services/AlignmentService.mjs';

function svc(plan, { due = [] } = {}) {
  const clock = { today: () => '2026-07-17', now: () => new Date('2026-07-17T12:00:00Z') };
  return new AlignmentService({
    lifePlanStore: { load: () => plan },
    metricsStore: { getLatest: () => ({}) },
    cadenceService: { resolve: () => ({ unit: { periodId: '2026-07-17' } }) },
    ceremonyRecordStore: { getRecords: () => [], hasRecord: () => false },
    ceremonyDueResolver: { listDue: () => due },
    clock,
  });
}

const sparsePlan = {
  purpose: null, values: [{ id: 'family', name: 'Family', rank: 1 }],
  beliefs: [], anti_goals: [], feedback: [],
  getActiveGoals: () => [], toJSON: () => ({}),
};

describe('AlignmentService stage + ceremony_due + plan_gap', () => {
  it('reports scaffolding stage and a plan_gap for a sparse plan', () => {
    const r = svc(sparsePlan).computeAlignment('u');
    expect(r.dashboard.stage).toBe('scaffolding');
    expect(r.dashboard.completeness.valueCount).toBe(1);
    expect(r.priorities.some((p) => p.type === 'plan_gap')).toBe(true);
  });

  it('emits a ceremony_due priority for each due ceremony', () => {
    const r = svc(sparsePlan, { due: [{ type: 'unit_intention', periodId: '2026-07-17', title: 'Set your intention' }] })
      .computeAlignment('u');
    const cd = r.priorities.find((p) => p.type === 'ceremony_due');
    expect(cd).toBeTruthy();
    expect(cd.title).toBe('Set your intention');
    expect(cd.ceremonyType).toBe('unit_intention');
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs`
Expected: FAIL — `stage`/`plan_gap`/`ceremony_due` absent.

- [ ] **Step 3: Implement in AlignmentService.mjs**

Add the resolver dep to the constructor destructure and store it:

```javascript
constructor({ lifePlanStore, metricsStore, cadenceService, ceremonyRecordStore, ceremonyDueResolver, clock }) {
  // …existing assignments…
  this.#ceremonyDueResolver = ceremonyDueResolver;
}
```

(Declare `#ceremonyDueResolver;` with the other private fields.)

Add the stage helper:

```javascript
  #computeStage(plan) {
    const valueCount = plan.values?.length || 0;
    const goalCount = plan.getActiveGoals?.().length || 0;
    const beliefCount = plan.beliefs?.length || 0;
    const hasPurpose = !!plan.purpose?.statement;
    const completeness = { hasPurpose, valueCount, goalCount, beliefCount };
    const active = hasPurpose && valueCount >= 2 && goalCount >= 1;
    return { stage: active ? 'active' : 'scaffolding', completeness };
  }
```

In `computeAlignment`, compute the stage and pass cadence into priorities; add stage to the dashboard:

```javascript
  const { stage, completeness } = this.#computeStage(plan);
  const priorities = this.#computePriorities(plan, snapshot, today, cadence, username);
  // …in the `dashboard` object literal, add:
  //   stage,
  //   completeness,
```

Change `#computePriorities(plan, snapshot, today)` to `#computePriorities(plan, snapshot, today, cadence, username)` and, after the existing branches (and after the deleted anti-goal block), add:

```javascript
    // plan_gap — nudge the user toward the next setup step for a sparse plan.
    if (!plan.purpose?.statement) {
      items.push({ type: 'plan_gap', title: 'Name your purpose', reason: 'One sentence on what this is all for', urgency: 'medium', gap: 'purpose', related_value: null });
    } else if ((plan.values?.length || 0) < 2) {
      items.push({ type: 'plan_gap', title: 'Add a couple of core values', reason: 'The plan needs values to track alignment', urgency: 'medium', gap: 'values', related_value: null });
    } else if ((plan.getActiveGoals?.().length || 0) === 0) {
      items.push({ type: 'plan_gap', title: 'Set your first goal', reason: 'Turn your values into something concrete', urgency: 'medium', gap: 'goals', related_value: null });
    }

    // ceremony_due — one per ceremony due today (dueness SSOT: CeremonyDueResolver).
    if (this.#ceremonyDueResolver && cadence) {
      const hasRecord = (type, periodId) => this.#ceremonyRecordStore?.hasRecord?.(username, type, periodId) || false;
      const due = this.#ceremonyDueResolver.listDue({
        plan, cadencePosition: cadence, cadenceConfig: plan.cadence || {}, today, hasRecord,
      });
      for (const d of due) {
        items.push({ type: 'ceremony_due', title: d.title, reason: 'Due today', urgency: 'high', ceremonyType: d.type, related_value: null });
      }
    }
```

(`items` is the local array the existing branches push into before the score/sort at the end — confirm the variable name in the file and match it.)

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire the resolver in the composition root**

In `backend/src/5_composition/modules/lifeplan.mjs`, import and construct it, then inject into `AlignmentService`:

```javascript
import { CeremonyDueResolver } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';
// …
const ceremonyDueResolver = new CeremonyDueResolver({ cadenceService: container.getCadenceService() });

const alignmentService = new AlignmentService({
  lifePlanStore: container.getLifePlanStore(),
  metricsStore: container.getMetricsStore(),
  cadenceService: container.getCadenceService(),
  ceremonyRecordStore: container.getCeremonyRecordStore(),
  ceremonyDueResolver,
  clock,
});
```

- [ ] **Step 6: Verify the composition still boots**

Run: `npx vitest run tests/isolated/composition/lifeplan-bootstrap.test.mjs`
Expected: PASS (alignmentService constructs and `computeAlignment` returns a dashboard with `stage`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/lifeplan/services/AlignmentService.mjs backend/src/5_composition/modules/lifeplan.mjs tests/isolated/lifeplan/services/alignment-stage-and-ceremony.test.mjs
git commit -m "feat(lifeplan): stage/completeness model + ceremony_due & plan_gap priorities"
```

---

## Phase 4 — Frontend usability: the funnel, the loop, dismissable alerts

### Task 16: Fix the silent-swallow purpose editor + rethrow section updates

**Files:**
- Modify: `frontend/src/modules/Life/hooks/useLifePlan.js` (add `setPurpose`, make `updateSection` rethrow)
- Modify: `frontend/src/modules/Life/views/plan/PurposeView.jsx` (use `setPurpose`, render error, close only on success)
- Test: `frontend/src/modules/Life/views/plan/PurposeView.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/views/plan/PurposeView.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const setPurpose = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock('../../hooks/useLifePlan.js', () => ({
  useLifePlan: () => ({ plan: { purpose: null }, loading: false, isEmpty: true, updateSection: vi.fn(), setPurpose }),
}));
import { PurposeView } from './PurposeView.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('PurposeView', () => {
  it('shows an error and keeps the editor open when the save fails', async () => {
    wrap(<PurposeView />);
    fireEvent.click(screen.getByRole('button', { name: '' }) || screen.getByTestId('edit')); // edit pencil
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'To raise kind kids.' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    // Editor stays open (textbox still present) so the input isn't lost.
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
```

> Note: give the edit `ActionIcon` a `data-testid="edit"` in PurposeView so the test can target it reliably; adjust the click selector accordingly.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/plan/PurposeView.test.jsx`
Expected: FAIL — no error shown, editor closes (input lost).

- [ ] **Step 3: Add `setPurpose` + rethrow in `useLifePlan.js`**

In `useLifePlan`, add before the `return`:

```javascript
  const setPurpose = useCallback(async (statement) => {
    const purpose = await api(`/purpose${qs}`, { method: 'POST', body: JSON.stringify({ statement }) });
    await fetchPlan();
    logger().info('purpose-set');
    return purpose;
  }, [qs, fetchPlan]);
```

Add `setPurpose` to the returned object. Make `updateSection` rethrow so callers can catch — change its `catch` block to:

```javascript
    } catch (err) {
      setError(err.message);
      logger().error('section-update-error', { section, error: err.message });
      throw err;
    }
```

- [ ] **Step 4: Update PurposeView.jsx** — use `setPurpose`, track a save error, close only on success:

```jsx
import { useState } from 'react';
import { Stack, Paper, Title, Text, Group, Badge, Button, Textarea, ActionIcon, Alert } from '@mantine/core';
import { IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { useLifePlan } from '../../hooks/useLifePlan.js';
import { humanize } from '../../lib/format.js';

export function PurposeView({ username }) {
  const { plan, loading, setPurpose } = useLifePlan(username);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);

  if (loading) return null; // replaced with <LoadingState/> in Task 8's sweep

  const purpose = plan?.purpose;
  const startEdit = () => { setDraft(purpose?.statement || ''); setSaveError(null); setEditing(true); };

  const saveEdit = async () => {
    setSaving(true); setSaveError(null);
    try {
      await setPurpose(draft);   // POST /purpose is create-or-update, planless-safe
      setEditing(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Purpose</Title>
        {!editing && (
          <ActionIcon variant="subtle" data-testid="edit" onClick={startEdit}><IconEdit size={18} /></ActionIcon>
        )}
      </Group>
      <Paper p="md" withBorder>
        {editing ? (
          <Stack gap="sm">
            {saveError && <Alert color="red" title="Couldn't save your purpose">{saveError}</Alert>}
            <Textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} autosize minRows={2} />
            <Group>
              <Button size="xs" leftSection={<IconCheck size={14} />} loading={saving} onClick={saveEdit}>Save</Button>
              <Button size="xs" variant="subtle" leftSection={<IconX size={14} />} onClick={() => setEditing(false)}>Cancel</Button>
            </Group>
          </Stack>
        ) : (
          <Text size="lg" fw={500}>{purpose?.statement || 'No purpose statement defined yet.'}</Text>
        )}
      </Paper>
      {(purpose?.grounded_in?.beliefs?.length > 0 || purpose?.grounded_in?.values?.length > 0) && (
        <Paper p="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Grounded In</Text>
          <Group gap="xs">
            {purpose.grounded_in.beliefs?.map((ref, i) => <Badge key={`b-${i}`} variant="light" size="sm">{humanize(ref)}</Badge>)}
            {purpose.grounded_in.values?.map((ref, i) => <Badge key={`v-${i}`} variant="light" size="sm" color="green">{humanize(ref)}</Badge>)}
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/plan/PurposeView.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Life/hooks/useLifePlan.js frontend/src/modules/Life/views/plan/PurposeView.jsx frontend/src/modules/Life/views/plan/PurposeView.test.jsx
git commit -m "fix(life-ui): purpose editor persists via POST /purpose and surfaces errors"
```

---

### Task 17: Honest ceremony config (no silent no-op, real channels, capture toggle)

**Files:**
- Modify: `frontend/src/modules/Life/views/plan/CeremonyConfig.jsx`
- Test: `frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx`

**Problems (audit S2):** `toggleCeremony`/`setChannel` `await updateCadence` with no try/catch → unhandled rejection + no feedback on a planless user; the channel select offers `push/email/screen` that no backend reads (real channels are `app/telegram/push`); `unit_capture` is missing so the 8pm nudge can't be disabled.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const notifyShow = vi.fn();
vi.mock('@mantine/notifications', () => ({ notifications: { show: (a) => notifyShow(a) } }));
const updateCadence = vi.fn(() => Promise.reject(new Error('Plan not found')));
vi.mock('../../hooks/useLifePlan.js', () => ({
  useCeremonyConfig: () => ({ config: { ceremonies: {} }, current: {}, loading: false, updateCadence }),
}));
import { CeremonyConfig } from './CeremonyConfig.jsx';

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('CeremonyConfig', () => {
  it('lists the daily capture ceremony so it can be disabled', () => {
    wrap(<CeremonyConfig />);
    expect(screen.getByText(/capture/i)).toBeInTheDocument();
  });
  it('notifies instead of silently failing when a toggle cannot save', async () => {
    wrap(<CeremonyConfig />);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    await waitFor(() => expect(notifyShow).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx`
Expected: FAIL — no "capture" row; no notification on failure.

- [ ] **Step 3: Edit CeremonyConfig.jsx**

Add `unit_capture` to `CEREMONY_TYPES` (after `unit_intention`):

```jsx
  { id: 'unit_capture', label: 'Daily Capture', description: 'Reflect on how the day went each evening' },
```

Replace the fake `CHANNELS` with the real channels:

```jsx
const CHANNELS = [
  { value: 'app', label: 'In-app' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'push', label: 'Push notification' },
];
```

Import notifications and wrap the two handlers:

```jsx
import { notifications } from '@mantine/notifications';
// …
  const toggleCeremony = async (type, enabled) => {
    try {
      await updateCadence({ ...config, ceremonies: { ...ceremonies, [type]: { ...(ceremonies[type] || {}), enabled } } });
    } catch (err) {
      notifications.show({ color: 'red', title: "Couldn't update ceremony", message: err.message });
    }
  };
  const setChannel = async (type, channel) => {
    try {
      await updateCadence({ ...config, ceremonies: { ...ceremonies, [type]: { ...(ceremonies[type] || {}), channel } } });
    } catch (err) {
      notifications.show({ color: 'red', title: "Couldn't update channel", message: err.message });
    }
  };
```

Update the channel `Select`'s default from `'push'` to `'app'` (`value={ceremonyConfig.channel || 'app'}`).

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/views/plan/CeremonyConfig.jsx frontend/src/modules/Life/views/plan/CeremonyConfig.test.jsx
git commit -m "fix(life-ui): ceremony config surfaces save errors, real channels, capture toggle"
```

---

### Task 18: `isEmpty` counts beliefs/qualities (planless funnel stops misfiring)

**Files:**
- Modify: `frontend/src/modules/Life/hooks/useLifePlan.js:57-60`
- Test: `frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx`

- [ ] **Step 1: Write the failing test** (extract the predicate to test it directly)

Add an exported pure helper to `useLifePlan.js` and test it:

```jsx
// frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx
import { describe, it, expect } from 'vitest';
import { planIsEmpty } from './useLifePlan.js';

describe('planIsEmpty', () => {
  it('is empty for null / {} / all-empty sections', () => {
    expect(planIsEmpty(null)).toBe(true);
    expect(planIsEmpty({})).toBe(true);
    expect(planIsEmpty({ goals: [], values: [], beliefs: [], qualities: [] })).toBe(true);
  });
  it('is NOT empty when only a belief exists', () => {
    expect(planIsEmpty({ beliefs: [{ id: 'b1' }] })).toBe(false);
  });
  it('is NOT empty when only a quality exists', () => {
    expect(planIsEmpty({ qualities: [{ id: 'q1' }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx`
Expected: FAIL — `planIsEmpty` not exported; belief-only case currently returns true.

- [ ] **Step 3: Extract + widen the predicate** in `useLifePlan.js`:

```javascript
export function planIsEmpty(plan) {
  if (!plan || Object.keys(plan).length === 0) return true;
  return (plan.goals?.length ?? 0) === 0
    && (plan.values?.length ?? 0) === 0
    && (plan.beliefs?.length ?? 0) === 0
    && (plan.qualities?.length ?? 0) === 0
    && !plan.purpose;
}
```

Replace the `isEmpty` `useMemo` body with `useMemo(() => planIsEmpty(plan), [plan])`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/hooks/useLifePlan.js frontend/src/modules/Life/hooks/useLifePlan.isEmpty.test.jsx
git commit -m "fix(life-ui): isEmpty counts beliefs and qualities"
```

---

### Task 19: Lifecycle-aware, dismissable PriorityList (the "now" payoff)

**Files:**
- Modify: `frontend/src/modules/Life/views/now/PriorityList.jsx` (use `priorityTypeMeta`, add dismiss + tap-through)
- Test: `frontend/src/modules/Life/views/now/PriorityList.test.jsx`

**Behavior:** cards render via the shared `priorityTypeMeta` (now includes `ceremony_due`/`plan_gap`); each card can be dismissed "for now" (persisted to `localStorage` under a stable key derived from `type` + `title`), and `ceremony_due`/`plan_gap`/`related_value` cards tap through to the relevant route.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/views/now/PriorityList.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
import { PriorityList } from './PriorityList.jsx';

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);
beforeEach(() => { localStorage.clear(); navigate.mockReset(); });

describe('PriorityList', () => {
  const items = [
    { type: 'ceremony_due', title: 'Set your intention', reason: 'Due today', ceremonyType: 'unit_intention' },
    { type: 'plan_gap', title: 'Name your purpose', reason: 'One sentence', gap: 'purpose' },
  ];
  it('taps a ceremony_due through to the ceremony route', () => {
    wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getByText('Set your intention'));
    expect(navigate).toHaveBeenCalledWith('/life/ceremony/unit_intention');
  });
  it('dismisses a card and keeps it dismissed', () => {
    wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getAllByLabelText(/dismiss/i)[1]); // plan_gap
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/views/now/PriorityList.test.jsx`
Expected: FAIL — no navigation, no dismiss control.

- [ ] **Step 3: Rewrite PriorityList.jsx**

```jsx
import { useState } from 'react';
import { Stack, Paper, Group, Text, Badge, ThemeIcon, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { priorityTypeMeta } from '../../theme/semantics.js';

const DISMISS_KEY = 'life.priorities.dismissed';
const keyOf = (item) => `${item.type}:${item.title}`;

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

function routeFor(item) {
  if (item.type === 'ceremony_due' && item.ceremonyType) return `/life/ceremony/${item.ceremonyType}`;
  if (item.type === 'plan_gap') {
    return { purpose: '/life/plan', values: '/life/plan/values', goals: '/life/plan/goals' }[item.gap] || '/life/coach';
  }
  if (item.related_value) return '/life/plan/values';
  return null;
}

export function PriorityList({ priorities = [] }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(loadDismissed);

  const dismiss = (item) => {
    const next = new Set(dismissed); next.add(keyOf(item));
    setDismissed(next);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
  };

  const visible = priorities.filter((p) => !dismissed.has(keyOf(p))).slice(0, 5);
  if (visible.length === 0) {
    return <Text size="sm" c="dimmed">You're all caught up — nothing needs your attention right now.</Text>;
  }

  return (
    <Stack gap="sm">
      {visible.map((item, i) => {
        const meta = priorityTypeMeta[item.type] || priorityTypeMeta.goal_deadline;
        const Icon = meta.icon;
        const route = routeFor(item);
        return (
          <Paper key={keyOf(item) + i} p="sm" withBorder
            className={route ? 'life-clickable' : undefined}
            onClick={route ? () => navigate(route) : undefined}>
            <Group wrap="nowrap">
              <ThemeIcon color={meta.color} variant="light" size="lg"><Icon size={18} /></ThemeIcon>
              <Stack gap={2} style={{ flex: 1 }}>
                <Text size="sm" fw={500}>{item.title}</Text>
                <Text size="xs" c="dimmed">{item.reason}</Text>
              </Stack>
              <Badge color={meta.color} variant="light" size="sm">{meta.label}</Badge>
              <ActionIcon variant="subtle" color="gray" aria-label={`Dismiss ${item.title}`}
                onClick={(e) => { e.stopPropagation(); dismiss(item); }}>
                <IconX size={14} />
              </ActionIcon>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/views/now/PriorityList.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Life/views/now/PriorityList.jsx frontend/src/modules/Life/views/now/PriorityList.test.jsx
git commit -m "feat(life-ui): lifecycle-aware, tap-through, dismissable priority cards"
```

---

### Task 20: Sparse-plan setup checklist on the Dashboard (stage-driven)

**Files:**
- Create: `frontend/src/modules/Life/hooks/useLifeStage.js`
- Modify: `frontend/src/modules/Life/views/now/Dashboard.jsx` (render a checklist when `stage === 'scaffolding'`)
- Test: `frontend/src/modules/Life/hooks/useLifeStage.test.jsx`

**Interfaces:**
- Produces: `useLifeStage(username?) → { stage, completeness, loading }` reading from `useAlignment('dashboard')`'s `dashboard.stage`/`dashboard.completeness` (added backend-side in Task 15).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Life/hooks/useLifeStage.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useAlignment.js', () => ({
  useAlignment: () => ({ data: { dashboard: { stage: 'scaffolding', completeness: { hasPurpose: false, valueCount: 1, goalCount: 0, beliefCount: 0 } } }, loading: false }),
}));
import { useLifeStage } from './useLifeStage.js';

describe('useLifeStage', () => {
  it('surfaces stage + completeness from the alignment dashboard', () => {
    const { result } = renderHook(() => useLifeStage());
    expect(result.current.stage).toBe('scaffolding');
    expect(result.current.completeness.valueCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run frontend/src/modules/Life/hooks/useLifeStage.test.jsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the hook**

```javascript
// frontend/src/modules/Life/hooks/useLifeStage.js
import { useAlignment } from './useAlignment.js';

export function useLifeStage(username) {
  const { data, loading } = useAlignment('dashboard', username);
  const dashboard = data?.dashboard;
  return {
    stage: dashboard?.stage || null,
    completeness: dashboard?.completeness || null,
    loading,
  };
}
```

> Confirm `useAlignment(mode, username)` accepts a username arg; if it reads username from context only, drop the 2nd arg.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run frontend/src/modules/Life/hooks/useLifeStage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Render the checklist in Dashboard.jsx**

Import `useLifeStage` and the primitives, and after the `planIsEmpty` card add a scaffolding checklist:

```jsx
  const { stage, completeness } = useLifeStage();
  // …inside the returned <Stack>, after the planIsEmpty block:
  {!planIsEmpty && stage === 'scaffolding' && completeness && (
    <SectionCard title="Finish setting up">
      <Stack gap="xs">
        <ChecklistRow done={completeness.hasPurpose} label="Name your purpose" onClick={() => navigate('/life/plan')} />
        <ChecklistRow done={completeness.valueCount >= 2} label="Add a couple of values" onClick={() => navigate('/life/plan/values')} />
        <ChecklistRow done={completeness.goalCount >= 1} label="Set your first goal" onClick={() => navigate('/life/plan/goals')} />
      </Stack>
    </SectionCard>
  )}
```

Add a small local `ChecklistRow` component in the same file:

```jsx
import { IconCircleCheck, IconCircle } from '@tabler/icons-react';
function ChecklistRow({ done, label, onClick }) {
  return (
    <Group gap="xs" className={done ? undefined : 'life-clickable'} onClick={done ? undefined : onClick}>
      {done ? <IconCircleCheck size={18} color="var(--mantine-color-teal-5)" /> : <IconCircle size={18} color="var(--mantine-color-dimmed)" />}
      <Text size="sm" c={done ? 'dimmed' : undefined} td={done ? 'line-through' : undefined}>{label}</Text>
    </Group>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Life/hooks/useLifeStage.js frontend/src/modules/Life/hooks/useLifeStage.test.jsx frontend/src/modules/Life/views/now/Dashboard.jsx
git commit -m "feat(life-ui): stage-driven setup checklist on the dashboard"
```

---

## Phase 5 — The coach: infrastructural identity + honest agency

> Verified mechanics: identity IS resolved to head-of-household for scheduled runs (`AgentOrchestrator.#resolveUserId`), but never reaches the tools (they require a `username` param the injector doesn't touch) nor the scheduled prompt (`runAssignment` calls `getSystemPrompt` directly, skipping the `## Active User` section that `buildPromptSections` appends). `UserIdInjector` keys strictly on `userId`. Renaming tool params `username → userId` is the SSOT fix.

### Task 21: Scheduled runs get the `## Active User` prompt section; no LLM call on empty input

**Files:**
- Modify: `backend/src/3_applications/agents/framework/BaseAgent.mjs` (`runAssignment` assembles via `buildPromptSections`)
- Modify: `backend/src/3_applications/agents/framework/Assignment.mjs` (`execute` returns early when `buildPrompt` is null)
- Test: `tests/isolated/agents/framework/assignment-identity.test.mjs`

- [ ] **Step 1: Write the failing test** (subclass BaseAgent per `BaseAgent.buildPromptSections.test.mjs`)

```javascript
// tests/isolated/agents/framework/assignment-identity.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '#apps/agents/framework/BaseAgent.mjs';
import { Assignment } from '#apps/agents/framework/Assignment.mjs';

class NullAssignment extends Assignment {
  static id = 'null-check';
  async gather() { return { nothing_actionable: true }; }
  buildPrompt() { return null; }
  async validate(raw) { return raw; }
  async act() {}
}

class FakeAgent extends BaseAgent {
  static id = 'fake';
  async getSystemPrompt() { return 'BASE'; }
}

describe('assignment identity + empty-input guard', () => {
  it('does not call the runtime when buildPrompt returns null', async () => {
    const execute = vi.fn(async () => ({ output: 'x' }));
    const assignment = new NullAssignment();
    await assignment.execute({
      agentRuntime: { execute }, workingMemory: { load: async () => ({ pruneExpired() {}, get() {} }), save: async () => {} },
      tools: [], systemPrompt: 'BASE', agentId: 'fake', userId: 'maya', context: {}, logger: { info() {} },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('runAssignment renders the Active User section into the scheduled prompt', async () => {
    let capturedPrompt = null;
    class CaptureAssignment extends Assignment {
      static id = 'cap';
      async gather() { return {}; }
      buildPrompt() { return 'DO SOMETHING'; }
      async validate(r) { return r; }
      async act() {}
    }
    const agent = new FakeAgent({
      agentRuntime: { execute: async ({ systemPrompt }) => { capturedPrompt = systemPrompt; return { output: 'ok' }; } },
      workingMemory: { load: async () => ({ pruneExpired() {}, get() {} }), save: async () => {} },
      logger: { info() {} },
    });
    agent.registerAssignment(new CaptureAssignment());
    await agent.runAssignment('cap', { userId: 'maya' });
    expect(capturedPrompt).toContain('Active User');
    expect(capturedPrompt).toContain('maya');
  });
});
```

> Adjust the `FakeAgent` constructor call to match BaseAgent's real constructor signature (deps object). Check `BaseAgent.buildPromptSections.test.mjs` for the exact shape and reuse it.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/agents/framework/assignment-identity.test.mjs`
Expected: FAIL — runtime called on null prompt; scheduled prompt lacks Active User.

- [ ] **Step 3: Guard the runtime call** in `Assignment.mjs` `execute()` — after `const prompt = this.buildPrompt(gathered, memory);` add:

```javascript
    if (prompt == null) {
      logger.info?.('assignment.skipped', { agentId, assignmentId: this.constructor.id, userId, reason: 'nothing_actionable' });
      await workingMemory.save(agentId, userId, memory);
      return null;
    }
```

- [ ] **Step 4: Assemble the scheduled prompt with sections** in `BaseAgent.mjs` `runAssignment()`. Replace:

```javascript
    const systemPrompt = await this.getSystemPrompt(augmentedContext);
```

with:

```javascript
    const augmentedContextWithUser = { ...augmentedContext, userId };
    const systemPrompt = await this.#assemblePrompt(augmentedContextWithUser);
```

and pass `context: augmentedContextWithUser` into `assignment.execute(...)`. (`#assemblePrompt` is a private method on the same class — accessible here.)

- [ ] **Step 5: Run it, verify it passes**

Run: `npx vitest run tests/isolated/agents/framework/assignment-identity.test.mjs`
Expected: PASS. Regression-guard: `npx vitest run tests/isolated/agents/framework/BaseAgent.buildPromptSections.test.mjs`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/framework/BaseAgent.mjs backend/src/3_applications/agents/framework/Assignment.mjs tests/isolated/agents/framework/assignment-identity.test.mjs
git commit -m "fix(agents): scheduled runs get Active User prompt; no LLM call on empty input"
```

---

### Task 22: Make coach identity infrastructural (`username` → injected `userId`)

**Files:**
- Modify: `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs` (all 10 tools: schema param + handler destructure)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs` (call plan tools with `{ userId }`)
- Modify existing test: `tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs` (execute with `userId`)
- Create: `tests/isolated/agents/framework/user-id-injector.test.mjs`

**Why this is the fix:** `userIdInjector` strips `userId` from the schema (the model can no longer supply/fabricate it) and injects `context.userId` under the `userId` arg. Renaming aligns the tools with the injector; the `user123` fabrication becomes structurally impossible.

- [ ] **Step 1: Write the injector test (proves the mechanism)**

```javascript
// tests/isolated/agents/framework/user-id-injector.test.mjs
import { describe, it, expect } from 'vitest';
import { userIdInjector, stripUserIdFromSchema } from '#apps/agents/framework/decorators/UserIdInjector.mjs';

describe('userIdInjector', () => {
  it('strips userId from the schema so the model cannot supply it', () => {
    const schema = { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' } }, required: ['userId', 'name'] };
    const out = stripUserIdFromSchema(schema);
    expect(out.properties.userId).toBeUndefined();
    expect(out.required).toEqual(['name']);
  });
  it('injects context.userId into the execute args', async () => {
    let received;
    const tool = { name: 't', parameters: { type: 'object', properties: { userId: {} }, required: ['userId'] }, execute: async (args) => { received = args; return 'ok'; } };
    const wrapped = userIdInjector(tool, { userId: 'maya' });
    await wrapped.execute({});
    expect(received.userId).toBe('maya');
  });
});
```

- [ ] **Step 2: Update the existing plan-tools test to use `userId`**

In `tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs`, change every `await tool.execute({ username: 'testuser' })` to `await tool.execute({ userId: 'testuser' })`, and any schema assertion that expects a `username` property to expect `userId`.

- [ ] **Step 3: Run both, verify they fail**

Run: `npx vitest run tests/isolated/agents/framework/user-id-injector.test.mjs tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs`
Expected: injector test PASSES (it already behaves this way); plan-tools test FAILS (tools still read `username`, so `execute({ userId })` gets `undefined`).

- [ ] **Step 4: Rename the param in every PlanToolFactory tool**

In `PlanToolFactory.mjs`, for all 10 tools change the schema block from:

```javascript
      properties: { username: { type: 'string', description: 'User identifier' }, /* …other props… */ },
      required: ['username', /* … */],
```

to:

```javascript
      properties: { userId: { type: 'string', description: 'User identifier' }, /* …other props… */ },
      required: ['userId', /* … */],
```

and change each handler signature from `execute: async ({ username, … })` to `execute: async ({ userId, … })`, using `userId` where it previously passed `username` to the service (e.g. `lifePlanStore.load(userId)`, `planAuthoringService.addGoal(userId, {...})`). Do this for: `get_plan`, `propose_goal_transition`, `propose_add_belief`, `propose_reorder_values`, `propose_add_evidence`, `record_feedback`, `create_goal`, `add_value`, `add_belief`, `set_purpose`.

- [ ] **Step 5: Update CadenceCheck's manual calls to the plan tools**

In `CadenceCheck.mjs` `gather()`/`act()`, change calls to plan tools from `{ username: userId }` to `{ userId }` — specifically `get_plan`. (Tools from other factories still using `username` — `check_ceremony_status`, `get_value_allocation`, `send_action_message` — are handled in Task 23; leave them for now, but note this task must not break them: they still take `username`, so keep those calls as `{ username: userId }` until Task 23.)

- [ ] **Step 6: Run the tests, verify they pass**

Run: `npx vitest run tests/isolated/agents/framework/user-id-injector.test.mjs tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs tests/isolated/agents/framework/user-id-injector.test.mjs tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs
git commit -m "fix(coach): plan tools use injected userId, not a model-typed username (kills user123)"
```

---

### Task 23: Rename `username` → `userId` in the remaining lifeplan-guide tool factories

**Files:**
- Modify: `tools/CeremonyToolFactory.mjs`, `tools/LifelogToolFactory.mjs`, `tools/NotificationToolFactory.mjs`, `tools/CoachingToolFactory.mjs` (any tool exposing a `username` param)
- Modify: `assignments/CadenceCheck.mjs` (all remaining `{ username: userId }` → `{ userId }`)
- Test: `tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs`

- [ ] **Step 1: Write the failing test — no lifeplan-guide tool exposes a `username` param**

```javascript
// tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs
import { describe, it, expect } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';
import { CeremonyToolFactory } from '#apps/agents/lifeplan-guide/tools/CeremonyToolFactory.mjs';
import { LifelogToolFactory } from '#apps/agents/lifeplan-guide/tools/LifelogToolFactory.mjs';
import { NotificationToolFactory } from '#apps/agents/lifeplan-guide/tools/NotificationToolFactory.mjs';

const stub = new Proxy({}, { get: () => () => ({}) });

it('no lifeplan-guide tool exposes a username param', () => {
  const factories = [
    new PlanToolFactory({ lifePlanStore: stub, goalStateService: stub, beliefEvaluator: stub, feedbackService: stub, planAuthoringService: stub }),
    new CeremonyToolFactory({ ceremonyService: stub, ceremonyRecordStore: stub, cadenceService: stub, lifePlanStore: stub }),
    new LifelogToolFactory({ aggregator: stub, metricsStore: stub, driftService: stub }),
    new NotificationToolFactory({ notificationService: stub }),
  ];
  for (const f of factories) {
    for (const tool of f.createTools()) {
      expect(tool.parameters?.properties?.username, `${tool.name} still has username`).toBeUndefined();
    }
  }
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs`
Expected: FAIL — Ceremony/Lifelog/Notification tools still expose `username`.

- [ ] **Step 3: Rename in each factory** exactly as in Task 22 (schema `username` → `userId`, handler destructure `username` → `userId`, internal service calls use `userId`). Then in `CadenceCheck.mjs`, change every remaining `{ username: userId }` to `{ userId }`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs`
Expected: PASS. Regression: `npx vitest run tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/ backend/src/3_applications/agents/lifeplan-guide/assignments/CadenceCheck.mjs tests/isolated/agents/lifeplan-guide/tool-identity.test.mjs
git commit -m "fix(coach): all lifeplan-guide tools use injected userId"
```

---

### Task 24: Prompt honesty — real agency, delete the "confirmation cards" fiction

**Files:**
- Modify: `backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs` (delete the false paragraph; describe real writers)
- Modify: `backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs` (replace the 4 dead `propose_*` tools with 2 confirmed writers on existing state)
- Test: `tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs`

**Problem (audit CRITICAL):** the 4 `propose_*` tools persist nothing and render nowhere, yet the prompt tells the model the user "sees these as confirmation cards and can Accept/Modify/Dismiss" — a lie that makes the coach think it acted. Replace them with confirm-in-conversation direct writers backed by services that already exist (`goalStateService` for transitions, `beliefEvaluator`/store for evidence), matching the existing `create_goal`/`add_value` confirm-first pattern (`CONFIRM_PREFIX`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { PlanToolFactory } from '#apps/agents/lifeplan-guide/tools/PlanToolFactory.mjs';

it('exposes transition_goal / add_evidence writers and no propose_* tools', async () => {
  const transitionGoal = vi.fn(() => ({ id: 'g1', state: 'committed' }));
  const factory = new PlanToolFactory({
    lifePlanStore: { load: () => ({}) },
    goalStateService: { transitionGoal },
    beliefEvaluator: {}, feedbackService: {},
    planAuthoringService: { addEvidence: vi.fn(() => ({ id: 'ev1' })) },
  });
  const names = factory.createTools().map((t) => t.name);
  expect(names).not.toContain('propose_goal_transition');
  expect(names).toContain('transition_goal');
  expect(names).toContain('add_evidence');
});
```

> Confirm the real method names on `goalStateService` / `planAuthoringService` for a goal-state transition and evidence write before finalizing (`goalStateService.transitionGoal(...)` and an evidence writer — the plan router already has `POST /goals/:id/transition` and `/beliefs/:id/evidence`, so equivalent service methods exist; wire the tools to those).

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs`
Expected: FAIL — `propose_*` still present; `transition_goal`/`add_evidence` absent.

- [ ] **Step 3: Replace the propose_* tools** in `PlanToolFactory.mjs`. Delete `propose_goal_transition`, `propose_add_belief`, `propose_reorder_values`, `propose_add_evidence`. Add two confirmed writers (reuse `CONFIRM_PREFIX` in the description), e.g.:

```javascript
    createTool({
      name: 'transition_goal',
      description: `${CONFIRM_PREFIX} Move an existing goal to a new state (e.g. considered → committed).`,
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
          goalId: { type: 'string' },
          state: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['userId', 'goalId', 'state'],
      },
      execute: async ({ userId, goalId, state, reason }) =>
        this.deps.goalStateService.transitionGoal(userId, goalId, state, reason),
    }),
    createTool({
      name: 'add_evidence',
      description: `${CONFIRM_PREFIX} Record a piece of evidence for or against an existing belief.`,
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
          beliefId: { type: 'string' },
          evidence: { type: 'string' },
          supports: { type: 'boolean' },
        },
        required: ['userId', 'beliefId', 'evidence'],
      },
      execute: async ({ userId, beliefId, evidence, supports }) =>
        this.deps.planAuthoringService.addEvidence(userId, beliefId, { evidence, supports }),
    }),
```

> Match the real service signatures. If `goalStateService.transitionGoal`/`planAuthoringService.addEvidence` differ, adapt the call (the router handlers at `plan.mjs` for `/goals/:id/transition` and `/beliefs/:id/evidence` show the exact service calls to mirror).

- [ ] **Step 4: Delete the false paragraph** in `prompts/system.mjs` (lines ~60-65, the "propose_* … confirmation cards … Accept, Modify, or Dismiss" block) and replace with an honest description:

```
## Changing the plan
You can write directly, but ALWAYS confirm with the user in the conversation first, then call the tool:
- create_goal / add_value / add_belief / set_purpose — create new items.
- transition_goal — move an existing goal to a new state.
- add_evidence — record evidence for/against an existing belief.
There are no separate "confirmation cards" — your confirmation is the conversation. Never claim you changed something you did not call a tool to change.
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npx vitest run tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs`
Expected: PASS. Regression: `npx vitest run tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs` (update its expected tool count/names — it asserted 10 tools including the 4 `propose_*`; it should now assert the new set).

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/agents/lifeplan-guide/tools/PlanToolFactory.mjs backend/src/3_applications/agents/lifeplan-guide/prompts/system.mjs tests/isolated/agents/lifeplan-guide/writer-tools.test.mjs tests/isolated/agents/lifeplan-guide/plan-tools.test.mjs
git commit -m "feat(coach): real transition_goal/add_evidence writers; delete confirmation-card fiction"
```

---

## Final verification & deploy

### Task 25: Full green + build + deploy + kiosk reload

- [ ] **Step 1: Run the full frontend Life test set**

Run: `npx vitest run frontend/src/modules/Life frontend/src/Apps/LifeApp.theme.test.js`
Expected: all PASS.

- [ ] **Step 2: Run the lifeplan + agent backend isolated tests**

Run: `npx vitest run tests/isolated/lifeplan tests/isolated/domain/lifeplan tests/isolated/api/routers/life-purpose-authoring.test.mjs tests/isolated/agents/lifeplan-guide tests/isolated/agents/framework tests/isolated/composition/lifeplan-bootstrap.test.mjs`
Expected: all PASS.

- [ ] **Step 3: Ensure the vitest gate has no new failures**

Run: `node scripts/gate-vitest.mjs`
Expected: exit 0 (no NEW failing files introduced).

- [ ] **Step 4: Confirm the deploy gate is clear** (no active fitness session / playing video — see `CLAUDE.local.md`), then build + deploy:

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify the running build + smoke the app**

Run: `curl -s http://localhost:3111/api/v1/life/plan/ | head -c 200` (expect JSON, not a hang), then load `https://daylightlocal.kckern.net/life` and confirm the dark theme, the dashboard checklist/priorities, and a coach reply that references the real plan.

- [ ] **Step 6: If viewed on the garage kiosk, hard-reload it**

```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```

- [ ] **Step 7: Update the audit + journey docs**

Mark the addressed findings in `docs/_wip/audits/2026-07-17-life-app-ux-fullscale-audit.md` and refresh the `[GAP]`/`[PARTIAL]` markers in `docs/reference/life/user-journey.md` that this plan closed. Commit.

---

## Self-Review

**Spec coverage vs. the 2026-07-17 UX audit:**
- §1 "ugly / no design system" → Tasks 1–9 (theme, semantics, format, primitives, defect fixes, full sweep). ✅
- §2 "no lifecycle awareness" → Tasks 15 (stage/completeness + ceremony_due/plan_gap), 19–20 (dismissable lifecycle priorities + setup checklist). ✅
- §3 "coach useless/clueless" → Tasks 21–24 (Active User in scheduled prompt, injected userId kills `user123`, real writers, honest prompt). ✅
- §4 "alerts vapid/spammy" → Tasks 11–13 (small-sample gate, anti-goal suppression, human drift copy), 19 (dismiss/tap-through). ✅ (A backend dedupe ledger/quiet-hours — audit P2 §10 — is deliberately deferred to a follow-up "Loops" plan; client-side dismiss covers the immediate "spammy" pain.)
- §5 "can't get started" → Tasks 10 + 16 (POST /purpose + non-swallowing editor), 17 (honest ceremony config), 18 (isEmpty), 20 (checklist). ✅

**Deferred by design (call out to the user, not silently dropped):** notification dedupe ledger + quiet hours; wiring `NightmareProximityService` to actually compute proximity (Task 12 only suppresses the alert); visible coach chat history restoration; signal detectors/metrics flywheel. These are the "Loops" (Plan C) scope from the audit's P2/P3.

**Type/name consistency:** `priorityTypeMeta` (Task 2) includes `ceremony_due`/`plan_gap` before the backend emits them (Task 15) — safe, the map just has extra keys until then. `planIsEmpty` (Task 18) and `useLifeStage` (Task 20) names are used consistently. `setPurpose` (hook, Task 16) ↔ `POST /purpose` (Task 10) ↔ `PlanAuthoringService.setPurpose` (exists) align. Tool param `userId` (Tasks 22–24) matches `UserIdInjector`'s strip/inject key.

**Placeholder scan:** each code step carries real code; the few "confirm the exact signature in the file" notes are flagged inline where the extraction agents couldn't guarantee a private method name (goalStateService/addEvidence signatures, useAlignment's username arg, the Log hook export shapes) — the implementer verifies against the named file before finalizing that one call.
