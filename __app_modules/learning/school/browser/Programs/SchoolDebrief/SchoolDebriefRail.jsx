import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import { TouchButton } from '../../../../../../frontend/src/lib/ui/index.js';
import Icon from '../../home/icons/Icon.jsx';

// Short names for the server's prompt ids (domain/schoolDebrief.mjs PROMPTS,
// plus the two legacy ids a resumed old day may still carry). An id this list
// does not know reads as "Part N", so a new server prompt never blanks a step.
const STEP_LABELS = Object.freeze({
  classes: 'Classes',
  moment: 'A moment',
  teach: 'Teach it',
  hard: 'What was hard',
  learned: 'What you learned',
  notable: 'Something notable',
});
const FINISHED = ['completed', 'excused'];

/**
 * The rail's step list, derived from what the program already knows: the
 * server's prompt list, which prompt is on screen, and the day's phase.
 * Each step is `todo`, `current` or `done`; the last step is the follow-up
 * questions (clarify probes and the quiz), counted once the server has them.
 */
export function debriefSteps({ prompts, view, day, promptIdx }) {
  const list = prompts ?? [];
  const phase = view?.phase ?? null;
  const finished = FINISHED.includes(phase);
  const inPrompts = Boolean(day && view) && promptIdx < list.length && !view?.questions && phase !== 'clarify' && !finished;
  const pastPrompts = Boolean(day && view) && !inPrompts && phase !== 'rejected';
  const steps = list.map((p, i) => {
    let state = 'todo';
    if (finished || pastPrompts) state = 'done';
    else if (inPrompts && i === promptIdx) state = 'current';
    else if (inPrompts && (i < promptIdx || p.id in (view?.entries ?? {}))) state = 'done';
    return { id: p.id, label: STEP_LABELS[p.id] ?? `Part ${i + 1}`, state };
  });
  const qs = view?.questions ?? null;
  const answered = qs ? Object.keys(view.answers ?? {}).length : 0;
  steps.push({
    id: 'questions',
    label: 'Questions',
    detail: qs ? `${Math.min(answered, qs.length)}/${qs.length}` : null,
    state: finished ? 'done' : pastPrompts ? 'current' : 'todo',
  });
  return steps;
}

/** Who this is, where they are in the debrief, and the way out. Always on screen. */
export default function SchoolDebriefRail({ learnerId = null, learnerName = null, late = false, steps = [], onStop = null }) {
  const name = learnerName ?? learnerId;
  return (
    <aside className="sd-rail" aria-label="Debrief progress">
      {learnerId && (
        <div className="sd-rail__learner">
          <ProfileAvatar id={learnerId} name={name} size={160} />
          <span className="sd-rail__name">{name}</span>
        </div>
      )}
      <div className="sd-rail__title">
        <span>After-school debrief</span>
        {late && <span className="sd-rail__late">Late</span>}
      </div>
      <ol className="sd-steps">
        {steps.map((s) => (
          <li key={s.id} className={`sd-step is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="sd-step__mark" aria-hidden="true">{s.state === 'done' ? <Icon name="check" /> : null}</span>
            <span className="sd-step__label">{s.label}</span>
            {s.detail && <span className="sd-step__detail">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {onStop && (
        <div className="sd-rail__foot">
          <TouchButton variant="secondary" onClick={onStop}>Stop for now</TouchButton>
          <p className="sd-rail__saved">Finished parts are saved.</p>
        </div>
      )}
    </aside>
  );
}
