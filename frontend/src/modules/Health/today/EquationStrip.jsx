import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';
import { headlineFor } from '@shared-contracts/health/budgetZone.mjs';

const n = (v) => Math.round(Number(v || 0)).toLocaleString();
const pct = (part, whole) => (whole > 0 ? `${(Math.max(0, part) / whole) * 100}%` : '0%');

// Macro goals live on goals as `macroGoals: { proteinG, carbsG, fatG }`.
const MACROS = [
  { key: 'protein', goalKey: 'proteinG', label: 'Protein' },
  { key: 'carbs', goalKey: 'carbsG', label: 'Carbs' },
  { key: 'fat', goalKey: 'fatG', label: 'Fat' },
];

/**
 * The day's calories as one bar on a fixed scale, with two marks that never
 * move with the day: the Goal (the budget — break-even less the planned
 * deficit) and Break even (the estimated burn, `maintenance`). The fill is NET
 * calories (eaten − burned): green up to the goal, amber between goal and
 * break-even, red past break-even. Exercise is a light band from net up to what
 * was eaten, so both numbers read off the same scale.
 * Nothing here is shown as a negative: "eaten", "burned", "left", "over".
 */
// Room past the furthest mark, so the break-even label and a small surplus fit.
const HEADROOM = 1.12;
function BudgetBar({ budget }) {
  const goal = Number(budget.budget) || 0;
  const breakEven = Number(budget.maintenance) || 0;
  const exercise = Math.max(0, Number(budget.exercise) || 0);
  const food = Math.max(0, Number(budget.food) || 0);
  const net = Math.max(0, food - exercise);
  const over = budget.status === 'over';
  const scale = Math.max(goal, breakEven, food) * HEADROOM;
  const band = (from, to) => ({ left: pct(from, scale), width: pct(Math.max(0, to - from), scale) });
  // A mark's label hangs off the side of its line with more room.
  const mark = (value, cls, label) => <span className={`health-budget__mark health-budget__mark--${cls}${value / scale > 0.5 ? ' health-budget__mark--end' : ''}`}
    style={{ left: pct(value, scale) }}><span className="health-budget__mark-label">{label} <b>{n(value)}</b></span></span>;
  const sameMark = breakEven > 0 && Math.round(breakEven) === Math.round(goal);
  const balance = breakEven > 0 ? breakEven - net : null;
  // The headline names the segment its number measures (the shared zone rule).
  // A legacy budget without a zone keeps the old two-way wording.
  const headline = budget.zone
    ? headlineFor(budget)
    : { value: Math.abs(budget.remaining), text: over ? 'over goal' : 'left' };
  const spoken = headline.value == null ? headline.text : `${n(headline.value)} ${headline.text}`;
  return (
    <div className="health-budget">
      <div className="health-budget__head">
        <span className="health-budget__headline" data-testid="budget-headline">
          {headline.value == null ? headline.text : <><strong>{n(headline.value)}</strong> kcal {headline.text}</>}
        </span>
        <span className="health-budget__terms" data-testid="budget-terms">
          <span>{n(food)} eaten</span>
          {exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className="health-budget__exercise-term">{n(exercise)} burned</span>
            <span className="health-budget__sep" aria-hidden="true">·</span>
            <span>{n(net)} net</span></> : null}
          {balance != null ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className={balance >= 0 ? 'health-budget__deficit' : 'health-budget__surplus'}>{balance >= 0 ? `${n(balance)} deficit` : `${n(-balance)} surplus`}</span></> : null}
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </span>
      </div>
      <div className="health-budget__scale">
        <div className="health-budget__track" role="img"
          aria-label={`${n(net)} net kcal of ${n(goal)} goal${breakEven ? `, break even ${n(breakEven)}` : ''}, ${spoken}`}>
          {exercise > 0 ? <span className="health-budget__burned" style={band(net, food)} /> : null}
          <span className="health-budget__net" style={band(0, Math.min(net, goal))} />
          {net > goal ? <span className="health-budget__over-goal" style={band(goal, breakEven > goal ? Math.min(net, breakEven) : net)} /> : null}
          {breakEven > goal && net > breakEven ? <span className="health-budget__surplus-fill" style={band(breakEven, net)} /> : null}
        </div>
        {mark(goal, 'goal', sameMark ? 'Goal · break even' : 'Goal')}
        {breakEven > 0 && !sameMark ? mark(breakEven, 'even', 'Break even') : null}
      </div>
    </div>
  );
}

/** One macro: grams, and a thin bar when it has a goal. */
function MacroMeter({ label, tone, value, partial, target }) {
  const hasGoal = target > 0;
  const over = hasGoal && value != null && value > target;
  const grams = value == null ? '—' : `${n(value)}${partial ? '+' : ''}`;
  const aria = `${label} ${grams} g${hasGoal ? ` of ${n(target)} g goal${over ? ', over goal' : ''}` : ''}${partial ? ', partial data' : ''}`;
  return (
    <div className={`health-macro-meter health-macro-tone--${tone}${over ? ' health-macro-meter--over' : ''}`} aria-label={aria}>
      <span className="health-macro-meter__label">{label}</span>
      <span className="health-macro-meter__value">{grams}{hasGoal ? <span className="health-macro-meter__target">{` / ${n(target)}`}</span> : null} g</span>
      {hasGoal ? <span className="health-macro-meter__track" aria-hidden="true">
        <span className="health-macro-meter__fill" style={{ width: `${Math.min(100, ((value || 0) / target) * 100)}%` }} />
      </span> : null}
    </div>
  );
}

/** Today's summary: the calorie budget as a bar, macros beside it. */
export function EquationStrip({ budget, budgetError, macroCoverage, goals, date, today, onDateChange, onSetupGoals }) {
  const macroGoals = goals?.macroGoals || budget?.goals?.macroGoals || {};
  return (
    <div className={`health-equation${budget?.status === 'over' ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Daily nutrition summary">
          <BudgetBar budget={budget} />
          <div className="health-equation__macros">
            {MACROS.map(m => {
              const coverage = macroCoverage?.[m.key];
              return <MacroMeter key={m.key} label={m.label} tone={m.key} value={coverage?.value ?? null}
                partial={coverage?.value != null && coverage.covered < coverage.total}
                target={Number(macroGoals[m.goalKey]) || 0} />;
            })}
          </div>
        </div>
      ) : budgetError?.status === 409 ? (
        <Button size="xs" variant="light" onClick={onSetupGoals}>Set up goals</Button>
      ) : (
        <span className="health-equation__math">—</span>
      )}
    </div>
  );
}
export default EquationStrip;
