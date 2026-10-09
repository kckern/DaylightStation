import { useMemo } from 'react';

const WINDOW = 20;

/**
 * Shows recent attempt results as colored dots and rolling accuracy.
 *
 * @param {{ attempts: { hit: boolean }[], accuracy: number }} props
 */
export function AttemptHistory({ attempts = [], accuracy = 0 }) {
  const recent = useMemo(() => attempts.slice(-WINDOW), [attempts]);

  if (recent.length === 0) return null;

  return (
    <div className="attempt-history">
      <div className="attempt-history__dots">
        {recent.map((a, i) => (
          <div
            key={i}
            className={`attempt-history__dot ${a.hit ? 'attempt-history__dot--hit' : 'attempt-history__dot--miss'}`}
          />
        ))}
      </div>
      <div className="attempt-history__accuracy">{accuracy}%</div>
      <div className="attempt-history__label">accuracy</div>
    </div>
  );
}
