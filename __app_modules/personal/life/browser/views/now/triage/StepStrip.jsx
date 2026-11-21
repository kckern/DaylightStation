import { IconCheck } from '@tabler/icons-react';

const STEP_LABELS = { urgent: 'Urgent', recap: 'Recap', unsure: 'Unsure', reply: 'Replies', todo: 'Todos' };
export const stepLabel = (id) => STEP_LABELS[id] ?? id;

/**
 * The session's steps in order with the overall progress bar under them.
 * `steps` is [{ id, count }] from /session; `currentStep`/`stepPos` place the open card;
 * `position`/`total` drive the bar and the "N left" counter.
 */
export function StepStrip({ steps = [], currentStep = null, stepPos = 0, position = 0, total = 0 }) {
  const currentIdx = steps.findIndex((s) => s.id === currentStep);
  const finished = currentStep === null;
  const completed = total > 0 ? Math.max(0, Math.min(total, position - (finished ? 0 : 1))) : 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="life-triage__progress">
      {steps.length > 1 && (
        <ol className="life-triage__steps" aria-label="Triage steps">
          {steps.map((s, i) => {
            const done = finished || (currentIdx >= 0 && i < currentIdx);
            const on = i === currentIdx;
            return (
              <li
                key={s.id}
                className={`life-triage__step${on ? ' life-triage__step--on' : ''}${done ? ' life-triage__step--done' : ''}`}
                aria-current={on ? 'step' : undefined}
              >
                {stepLabel(s.id)}
                {on && s.count > 1 && <span className="life-triage__step-pos"> {stepPos}/{s.count}</span>}
                {done && <IconCheck size={11} aria-label="done" className="life-triage__step-check" />}
              </li>
            );
          })}
        </ol>
      )}
      <div className="life-triage__bar-row">
        <div className="life-triage__bar" role="progressbar" aria-label="Triage progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
          <i style={{ width: `${pct}%` }} />
        </div>
        {/* Remaining, not "n / N": beside the step's own "1/45" a second fraction read as a
            contradiction (2026-11-20, "why two different denominators?"). */}
        {!finished && <span className="life-triage__count">{total - position + 1} left</span>}
      </div>
    </div>
  );
}

export default StepStrip;
