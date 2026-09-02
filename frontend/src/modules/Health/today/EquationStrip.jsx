import { Button } from '@mantine/core';
import { DateStepper } from '@/lib/ui';

const n = (v) => Number(v || 0).toLocaleString();

/** The LoseIt signature: Budget − Food + Exercise = Net, under/over. */
export function EquationStrip({ budget, budgetError, date, today, onDateChange, onSetupGoals }) {
  return (
    <div className={`health-equation${budget?.status === 'over' ? ' health-equation--over' : ''}`}>
      <DateStepper date={date} onChange={onDateChange} max={today} />
      {budget ? (
        <div className="health-equation__math" aria-label="Calorie equation">
          <span>{n(budget.budget)}</span>
          <span className="health-equation__op">−</span>
          <span>{n(budget.food)}</span>
          <span className="health-equation__op">+</span>
          <span>{n(budget.exercise)}</span>
          <span className="health-equation__op">=</span>
          <strong className="health-equation__net">{n(Math.abs(budget.remaining))}</strong>
          <span className="health-equation__status">{budget.status}</span>
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
