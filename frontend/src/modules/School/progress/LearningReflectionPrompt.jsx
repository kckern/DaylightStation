import { useMemo, useState } from 'react';
import { useSchoolProfile } from '../identity/SchoolProfileContext.jsx';
import { schoolApi } from '../schoolApi.js';

const ASSESSMENTS = Object.freeze([
  ['not_yet', 'Not yet'], ['uncertain', 'Unsure'], ['ready', 'Ready'],
]);
const STRATEGIES = Object.freeze([
  ['checked-work', 'Checked my work'], ['used-example', 'Used an example'], ['asked-why', 'Asked why'],
]);

/** Optional, score-independent reflection usable after any learning module. */
export default function LearningReflectionPrompt({ activity, learning = {}, onDone, continueLabel = 'Continue lesson' }) {
  const { currentUser } = useSchoolProfile();
  const [selfAssessment, setSelfAssessment] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [strategyIds, setStrategyIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const observationId = useMemo(
    () => `web:${activity.sessionId ?? activity.id}:self-reflection`,
    [activity.id, activity.sessionId],
  );

  if (!currentUser) return <button type="button" className="school-runner__done" onClick={onDone}>{continueLabel}</button>;

  const toggleStrategy = (id) => setStrategyIds((current) => (
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  ));
  const save = async () => {
    if ((!selfAssessment && confidence === null && strategyIds.length === 0) || saving) return;
    setSaving(true);
    setError(null);
    const response = await schoolApi.recordReflection({
      observationId, learnerId: currentUser.id, activity, learning,
      selfRegulation: {
        phase: 'self_reflection',
        ...(selfAssessment ? { selfAssessment } : {}),
        ...(confidence !== null ? { confidence } : {}),
        strategyIds,
      },
    });
    setSaving(false);
    if (!response.ok) { setError('Reflection was not saved. Try again or skip.'); return; }
    onDone();
  };

  return (
    <section className="school-reflection" aria-label="Optional reflection">
      <div><p>Optional reflection</p><h3>How does this feel now?</h3></div>
      <div className="school-reflection__choices" aria-label="Self assessment">
        {ASSESSMENTS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={selfAssessment === id} onClick={() => setSelfAssessment(id)}>{label}</button>
        ))}
      </div>
      <div className="school-reflection__confidence">
        <span>Confidence</span>
        {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-pressed={confidence === value} onClick={() => setConfidence(value)}>{value}</button>)}
      </div>
      <div className="school-reflection__strategies" aria-label="Strategies used">
        {STRATEGIES.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={strategyIds.includes(id)} onClick={() => toggleStrategy(id)}>{label}</button>
        ))}
      </div>
      {error && <p role="alert" className="school-reflection__error">{error}</p>}
      <div className="school-reflection__actions">
        <button type="button" onClick={onDone}>Skip</button>
        <button type="button" disabled={saving || (!selfAssessment && confidence === null && strategyIds.length === 0)} onClick={save}>Save &amp; continue</button>
      </div>
    </section>
  );
}

