import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';

const n = (v) => Number(v || 0).toLocaleString();

function DailyMetric({ label, value, unit, operator, tone, partial, ariaLabel }) {
  const macroTone = ['protein', 'carbs', 'fat'].includes(tone) ? ` health-macro-tone--${tone}` : '';
  return (
    <div className={`health-daily-metric health-daily-metric--${tone}${macroTone}`} aria-label={ariaLabel || label} data-testid="daily-metric">
      <span className="health-daily-metric-label">{label}</span>
      <span className="health-daily-metric-readout">
        <span className="health-daily-metric-operator" aria-hidden="true">{operator || ''}</span>
        <span className="health-daily-metric-value">
          <span className="health-daily-metric-number">{value == null ? '—' : n(value)}</span>{partial ? '+' : ''}
        </span>
        <span className="health-daily-metric-unit">{unit}</span>
      </span>
    </div>
  );
}

/** The LoseIt signature: Budget − Food + Exercise = Net, under/over. */
export function EquationStrip({ budget, budgetError, macroCoverage, date, today, onDateChange, onSetupGoals }) {
  const macro = (key) => {
    const coverage = macroCoverage?.[key];
    return {
      value: coverage?.value ?? null,
      partial: coverage?.value != null && coverage.covered < coverage.total,
    };
  };
  const protein = macro('protein');
  const carbs = macro('carbs');
  const fat = macro('fat');
  return (
    <div className={`health-equation${budget?.status === 'over' ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Daily nutrition summary">
          <DailyMetric label="Protein" value={protein.value} partial={protein.partial} unit="g" tone="protein" />
          <DailyMetric label="Carbs" value={carbs.value} partial={carbs.partial} unit="g" tone="carbs" />
          <DailyMetric label="Fat" value={fat.value} partial={fat.partial} unit="g" tone="fat" />
          <DailyMetric label="Budget" value={budget.budget} unit="kcal" tone="budget" />
          <DailyMetric label="Food" value={budget.food} unit="kcal" operator="−" tone="food" ariaLabel="Food calories" />
          <DailyMetric label="Exercise" value={budget.exercise} unit="kcal" operator="+" tone="exercise" />
          <DailyMetric label={budget.status === 'over' ? 'Over' : 'Under'} value={Math.abs(budget.remaining)}
            unit="kcal" operator="=" tone={budget.status === 'over' ? 'over' : 'under'}
            ariaLabel={`${budget.status === 'over' ? 'Over' : 'Under'} calories`} />
          {budget.stale ? <span className="health-equation__stale" title="Latest weigh-in is over a week old">stale wt</span> : null}
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
