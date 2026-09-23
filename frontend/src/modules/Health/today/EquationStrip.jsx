import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';

const n = (v) => Math.round(Number(v || 0)).toLocaleString();
const pct = (part, whole) => (whole > 0 ? `${(Math.max(0, part) / whole) * 100}%` : '0%');

// Macro goals live on goals as `macroGoals: { proteinG, carbsG, fatG }`.
const MACROS = [
  { key: 'protein', goalKey: 'proteinG', label: 'Protein' },
  { key: 'carbs', goalKey: 'carbsG', label: 'Carbs' },
  { key: 'fat', goalKey: 'fatG', label: 'Fat' },
];

/**
 * The day's calories as one bar. Capacity is budget + exercise; food fills it.
 * Once food passes capacity the scale becomes the food total, so the capacity
 * marker moves in and the overage is drawn past it rather than off the end.
 * Nothing here is shown as a negative: "eaten of", "left", "over".
 */
function BudgetBar({ budget }) {
  const allowance = Number(budget.budget) || 0;
  const exercise = Math.max(0, Number(budget.exercise) || 0);
  const food = Math.max(0, Number(budget.food) || 0);
  const capacity = allowance + exercise;
  const over = budget.status === 'over';
  const scale = Math.max(capacity, food);
  const within = Math.min(food, capacity);
  return (
    <div className="health-budget">
      <div className="health-budget__head">
        <span className="health-budget__headline" data-testid="budget-headline">
          <strong>{n(Math.abs(budget.remaining))}</strong> kcal {over ? 'over' : 'left'}
        </span>
        <span className="health-budget__terms" data-testid="budget-terms">
          <span>{n(food)} eaten of {n(capacity)}</span>
          <span className="health-budget__sep" aria-hidden="true">·</span>
          <span>budget {n(allowance)}</span>
          {exercise > 0 ? <><span className="health-budget__sep" aria-hidden="true">·</span>
            <span className="health-budget__exercise-term">+{n(exercise)} exercise</span></> : null}
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
        </span>
      </div>
      <div className="health-budget__track" role="img" aria-label={`${n(food)} of ${n(capacity)} kcal${over ? `, ${n(food - capacity)} over` : `, ${n(capacity - food)} left`}`}>
        {exercise > 0 ? <span className="health-budget__exercise" style={{ left: pct(allowance, scale), width: pct(exercise, scale) }} /> : null}
        <span className="health-budget__food" style={{ width: pct(within, scale) }} />
        {food > capacity ? <span className="health-budget__over" style={{ left: pct(capacity, scale), width: pct(food - capacity, scale) }} /> : null}
        {food > capacity ? <span className="health-budget__marker" style={{ left: pct(capacity, scale) }} /> : null}
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
