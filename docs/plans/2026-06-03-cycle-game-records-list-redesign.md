# Cycle Game — Records List Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement task-by-task.

**Goal:** Replace the free-flowing records rail with a scannable, columnar
**History** list — fixed `DISTANCE` / `TIME` columns, a goal marker, an explicit
winner, and the date/time — resolving the UX audit
(`docs/_wip/audits/2026-06-03-cycle-game-records-list-ux-evaluation.md`).

**Architecture:** Pure presentational change to one surface. The data already
exists in `ghostCandidates` (`CycleGameContainer.jsx`); we widen the `records` memo
to pass it through, then restructure `cgh-record` into a CSS-grid table with a
header. No engine/director/persistence changes.

**Tech Stack:** React (.jsx), SCSS (`_cgTokens` synthwave tokens), vitest +
@testing-library/react.

**Test command:** `npx --no-install vitest run --config vitest.config.mjs <path>`.

**Target layout**

```
 HISTORY
 RIDERS         DISTANCE    TIME      WHEN
 👑 User_3        105 m       🏁 1:00   Today 6:12p
 👑 User_3 ·ᶠ     171 m       🏁 1:00   Today 5:48p
 👑 User_3        🏁 1.00 km  5:13      Today 3:30p
 👑 User_2 ·ᵐ    🏁 1.00 km  3:47      Yest 7:22p
```
🏁 marks the GOAL cell (distance-goal vs time-goal = the race type). 👑 = winner.

---

## Task 1: Widen the `records` row model

The rail needs both metrics, which one is the goal, the winner, and a compact
"when". All of it is already on `ghostCandidates`; expose it.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameContainer.jsx`
  (the `records` memo, ~`:472–481`; and `ghostCandidates`, ~`:440–470`)
- Create: `frontend/src/modules/Fitness/lib/cycleGame/recordRow.js` (pure helpers)
- Test: `frontend/src/modules/Fitness/lib/cycleGame/recordRow.test.js`

**Step 1 — failing test** (`recordRow.test.js`):
```javascript
import { describe, it, expect } from 'vitest';
import { relativeWhen, buildRecordRow } from './recordRow.js';

describe('relativeWhen', () => {
  // `todayYmd` is injected (pure — no Date.now()).
  it('labels today / yesterday / older', () => {
    expect(relativeWhen('2026-06-03', '6:12 pm', '2026-06-03')).toBe('Today 6:12p');
    expect(relativeWhen('2026-06-02', '7:22 pm', '2026-06-03')).toBe('Yest 7:22p');
    expect(relativeWhen('2026-05-28', '8:00 am', '2026-06-03')).toBe('May 28 8:00a');
  });
});

describe('buildRecordRow', () => {
  const base = {
    raceId: '20260603181200', day: '2026-06-03', timeOfDay: '6:12 pm',
    winnerName: 'User_3',
    participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/a' },
                   { id: 'user_2', displayName: 'User_2', avatarSrc: '/b' }]
  };
  it('a distance race marks the distance cell as the goal', () => {
    const r = buildRecordRow({ ...base, winCondition: 'distance',
      goalLabel: '1.00 km', scoreLabel: '5:13' }, '2026-06-03');
    expect(r.distanceLabel).toBe('1.00 km');
    expect(r.timeLabel).toBe('5:13');
    expect(r.goalColumn).toBe('distance');
    expect(r.when).toBe('Today 6:12p');
    expect(r.winnerId).toBe('user_3');
    expect(r.others).toEqual([{ id: 'user_2', displayName: 'User_2', avatarSrc: '/b' }]);
  });
  it('a time race marks the time cell as the goal', () => {
    const r = buildRecordRow({ ...base, winCondition: 'time',
      goalLabel: '1:00', scoreLabel: '105 m' }, '2026-06-03');
    expect(r.distanceLabel).toBe('105 m');
    expect(r.timeLabel).toBe('1:00');
    expect(r.goalColumn).toBe('time');
  });
});
```

**Step 2 — run red.** Import unresolved.

**Step 3 — implement `recordRow.js`:**
```javascript
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Compact time: "6:12 pm" -> "6:12p". Tolerates missing input.
function compactTime(t) {
  const m = String(t || '').match(/^(\d{1,2}:\d{2})\s*([ap])m$/i);
  return m ? `${m[1]}${m[2].toLowerCase()}` : '';
}

/** Relative "when" label. todayYmd is injected so this stays pure/testable. */
export function relativeWhen(dayYmd, timeOfDay, todayYmd) {
  const tt = compactTime(timeOfDay);
  if (!dayYmd || dayYmd === 'unknown') return '';
  if (dayYmd === todayYmd) return `Today ${tt}`.trim();
  // yesterday = todayYmd minus one calendar day (string math on Y-M-D)
  const [y, m, d] = todayYmd.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1)); // UTC construct = pure given inputs
  const yest = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
  if (dayYmd === yest) return `Yest ${tt}`.trim();
  const [, mm, dd] = dayYmd.split('-').map(Number);
  return `${MONTHS[(mm || 1) - 1]} ${dd} ${tt}`.trim();
}

/**
 * Build a columnar record row. Every race has ONE distance + ONE time value; the
 * goal column is the win condition. goalLabel/scoreLabel come pre-formatted.
 */
export function buildRecordRow(g, todayYmd) {
  const isDistance = g.winCondition === 'distance';
  return {
    raceId: g.raceId,
    winnerId: g.participants?.[0]?.id ?? null,
    winnerName: g.winnerName,
    winnerAvatar: g.participants?.[0]?.avatarSrc ?? null,
    others: (g.participants || []).slice(1).map((p) => ({ id: p.id, displayName: p.displayName, avatarSrc: p.avatarSrc })),
    distanceLabel: isDistance ? g.goalLabel : g.scoreLabel,
    timeLabel: isDistance ? g.scoreLabel : g.goalLabel,
    goalColumn: isDistance ? 'distance' : 'time',
    when: relativeWhen(g.day, g.timeOfDay, todayYmd)
  };
}
```
> Note: `relativeWhen` builds a `Date` only from injected Y-M-D integers via
> `Date.UTC` — deterministic, no `Date.now()`. The "today" string is computed once
> in the container (allowed there) and passed in.

**Step 4 — run green.**

**Step 5 — wire the container `records` memo:**
```javascript
import { buildRecordRow } from '@/modules/Fitness/lib/cycleGame/recordRow.js';
// inside the component, compute today's Y-M-D once (container may read the clock):
const todayYmd = useMemo(() => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}, []);
const records = useMemo(
  () => ghostCandidates.slice(0, 12).map((g) => buildRecordRow(g, todayYmd)),
  [ghostCandidates, todayYmd]
);
```
(Keep `avatars` if any other consumer needs it; the new row supersedes it for the
rail.)

**Step 6 — commit:** `feat(cycle-game): columnar record-row model (winner, both metrics, goal column, when)`

---

## Task 2: Restructure the rail markup into a columnar table

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx`
  (the `cgh-records` `<ol>`, ~`:685–720`; rename the `Records` label → `History`)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`
  (extend records assertions)

**Step 1 — failing test** (add to the existing suite; use the new row shape):
```javascript
it('renders the history table: winner, both metric columns, goal mark, and when', () => {
  const records = [{
    raceId: 'r1', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a',
    others: [{ id: 'user_2', displayName: 'User_2', avatarSrc: '/b' }],
    distanceLabel: '1.00 km', timeLabel: '5:13', goalColumn: 'distance', when: 'Today 6:12p'
  }];
  render(<CycleGameHome {...baseProps} records={records} />);
  const row = screen.getByTestId('record-r1');
  expect(row).toHaveTextContent('User_3');
  expect(row).toHaveTextContent('1.00 km');
  expect(row).toHaveTextContent('5:13');
  expect(row).toHaveTextContent('Today 6:12p');
  // the goal cell is the distance cell
  expect(row.querySelector('[data-goal="true"][data-col="distance"]')).toBeTruthy();
  // header row present
  expect(screen.getByTestId('cycle-game-records')).toHaveTextContent('HISTORY');
});
```

**Step 2 — run red.**

**Step 3 — implement.** Replace the `cgh-record__btn` body with a grid row + a
header `<li>`. Sketch:
```jsx
<div className="cgh-section-label">History</div>
{records.length === 0 ? (
  <div className="cgh-empty">No races yet</div>
) : (
  <ol className="cgh-records cgh-records--table">
    <li className="cgh-records__head" aria-hidden="true">
      <span>Riders</span><span>Distance</span><span>Time</span><span>When</span>
    </li>
    {records.map((rec, i) => (
      <li key={rec.raceId || i} className="cgh-record">
        <button type="button" className="cgh-record__btn" data-testid={`record-${rec.raceId}`}
          onClick={() => onSelectRecord?.(rec.raceId)}
          aria-label={`${rec.winnerName} won — ${rec.distanceLabel}, ${rec.timeLabel}, ${rec.when}`}>
          <span className="cgh-record__riders">
            <img className="cgh-record__winner" src={rec.winnerAvatar} alt={rec.winnerName}
              title={rec.winnerName} onError={(e)=>{e.currentTarget.src=FALLBACK_AVATAR;}} />
            <span className="cgh-record__crown" aria-hidden="true">👑</span>
            <span className="cgh-record__winner-name">{rec.winnerName}</span>
            {rec.others.length > 0 && (
              <span className="cgh-record__others">
                {rec.others.slice(0,3).map((o)=>(
                  <img key={o.id} className="cgh-record__other" src={o.avatarSrc} alt={o.displayName}
                    title={o.displayName} onError={(e)=>{e.currentTarget.src=FALLBACK_AVATAR;}} />
                ))}
                {rec.others.length > 3 && <span className="cgh-record__more">+{rec.others.length-3}</span>}
              </span>
            )}
          </span>
          <span className="cgh-record__cell" data-col="distance" data-goal={rec.goalColumn==='distance'}>
            {rec.goalColumn==='distance' && <span className="cgh-record__flag" aria-hidden="true">🏁</span>}
            {rec.distanceLabel}
          </span>
          <span className="cgh-record__cell" data-col="time" data-goal={rec.goalColumn==='time'}>
            {rec.goalColumn==='time' && <span className="cgh-record__flag" aria-hidden="true">🏁</span>}
            {rec.timeLabel}
          </span>
          <span className="cgh-record__when">{rec.when}</span>
        </button>
      </li>
    ))}
  </ol>
)}
```
> The `aria-label` summarizes the row for screen readers (the header is
> `aria-hidden`). The 🏁 sits only on the goal cell → race type is legible without
> color (fixes audit F5).

**Step 4 — run green** (whole widget suite).

**Step 5 — commit:** `feat(cycle-game): History table markup — winner, goal-marked metric columns, when`

---

## Task 3: SCSS — grid columns, header, winner emphasis, goal badge, focus

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss`
  (the `cgh-record*` rules)

**Step 1 — implement** (consume `_cgTokens`; the file already `@use`s it as `t`):
- `.cgh-records--table` and `.cgh-record__btn`, `.cgh-records__head`:
  `display: grid; grid-template-columns: minmax(0,1.4fr) auto auto auto; gap: 10px; align-items: center;`
  (one shared template so header + rows align).
- `.cgh-records__head span`: `@include t.cg-eyebrow; font-size: 0.62rem;`.
- `.cgh-record__cell`: `@include t.cg-numeral(t.$cg-cyan);` tabular; right-align;
  `&[data-goal="true"]` → muted/non-cyan + the flag (goal is context, not the
  headline). Make the **result** cells the bright cyan, the **goal** cells calmer —
  so the eye lands on the achievement.
- `.cgh-record__riders`: flex; winner avatar 40px with a crown badge; winner name
  Roboto Condensed 700; `.cgh-record__other` 22px, `opacity: 0.7`, overlapped
  (`margin-left: -8px`); `.cgh-record__more` muted chip.
- `.cgh-record__when`: `font-family: t.$cg-mono; color: t.$cg-faint; font-size: 0.72rem;`
- `.cgh-record__flag`: small, `margin-right: 4px`.
- **Focus (TV):** `.cgh-record__btn:focus-visible { outline: 2px solid t.$cg-cyan;
  outline-offset: 2px; background: rgba(33,230,255,0.06); border-radius: 12px; }`
- Strengthen the row divider (`border-bottom: 1px solid t.$cg-border-soft;`).
- Remove the now-unused `.cgh-record__chip` / `__avatars` / `__score` rules (or
  keep `__score` empty-state styling if reused).

**Step 2 — verify** the widget suite stays green (SCSS doesn't affect jsdom assertions).

**Step 3 — commit:** `style(cycle-game): History table — aligned columns, winner emphasis, goal badge, TV focus`

---

## Task 4: Visual verification (kiosk 1280×720)

SCSS/layout regressions are invisible to jsdom — verify with a screenshot harness
(reuse the `_deleteme/cyclegame-preview.*` pattern, or a small `CycleGameHome`
fixture page): render the rail with a mixed set (distance + time races, solo +
multi, today + older) and confirm:
- columns align across header + rows; distances stack in one column, times in
  another;
- the 🏁 sits on the correct (goal) cell per race type;
- the winner is obvious; runner-ups are clearly secondary;
- the `When` column reads (Today / Yest / date);
- focus state is unmistakable;
- it fits the rail width without overflow (if tight, fall back to the two-line
  row variant noted in the audit).

Capture before/after screenshots for the record. **No commit** (throwaway harness;
park under `_deleteme/`).

---

## Notes & risks

- **DRY:** reuse `formatDistance` + the existing `fmtMs`; `relativeWhen` is the only
  new formatter. Don't reformat already-formatted `goalLabel`/`scoreLabel`.
- **Purity:** `recordRow.js` takes `todayYmd` as an argument (no `Date.now()` inside)
  so it's unit-testable; the container computes "today" once.
- **Unit consistency (audit F9):** out of scope for v1 (we keep `formatDistance`'s
  m/km output) — but now both live in one comparable column, which is the bigger
  win. Normalizing the threshold can be a fast follow.
- **Width:** the rail is a sidebar `<aside>`; if 4 columns crowd, drop the winner
  *name* (keep crowned avatar) before dropping a column, or adopt the two-line
  fallback.
- **"Records" → "History":** if literal personal-bests are wanted later, that's a
  separate feature (filter/agg), not this layout change.
```
