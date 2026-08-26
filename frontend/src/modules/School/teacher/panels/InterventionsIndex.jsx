/**
 * "Something went wrong — which tool?" (UX audit IA4). Every repair the
 * workspace can do, named for the situation rather than the mechanism, each
 * with exactly one home. A tool whose home is a specific lesson gets its
 * route described rather than a link that could only guess at the lesson.
 */
import { INTERVENTIONS } from '../interventions.js';

export default function InterventionsIndex({ learnerId = null, scopes = null }) {
  const items = scopes ? INTERVENTIONS.filter((item) => scopes.includes(item.scope)) : INTERVENTIONS;
  return (
    <section className="teacher-panel teacher-interventions">
      <h3 className="teacher-panel__title">Which repair do I need?</h3>
      <p className="teacher-muted">Use the narrowest one that matches what actually happened. Every change is recorded with your name and a reason.</p>
      <ul className="teacher-interventions__list">
        {items.map((item) => {
          const href = item.href && (item.scope === 'learner' ? (learnerId ? item.href(learnerId) : null) : item.href());
          return (
            <li key={item.id}>
              {href ? <a className="teacher-interventions__label" href={href}>{item.label}</a>
                : <strong className="teacher-interventions__label">{item.label}</strong>}
              <span className="teacher-interventions__when">{item.useWhen}</span>
              <small className="teacher-interventions__where">{item.where}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
