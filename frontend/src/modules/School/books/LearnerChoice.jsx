import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';

/**
 * "Who's reading?" — the one grid, shared by both doors into the shelf.
 *
 * The scan door has the book and asks who; the panel door has nobody and asks
 * the same thing first. A child should not have to learn two ways to say which
 * one they are, so the faces, their size, and the tap target are one component
 * rather than two that drift.
 *
 * @param {{roster: {id: string, name?: string}[], busy?: boolean,
 *   onChoose: (learnerId: string) => void}} props
 */
export default function LearnerChoice({ roster = [], busy = false, onChoose }) {
  return (
    <div className="school-book-scan__learners">
      {roster.map((learner) => (
        <button
          type="button"
          key={learner.id}
          disabled={busy}
          onClick={() => onChoose(learner.id)}
          aria-label={learner.name || learner.id}
        >
          <ProfileAvatar id={learner.id} name={learner.name || learner.id} size={256} />
          <span className="school-book-scan__learner-name">{learner.name || learner.id}</span>
        </button>
      ))}
    </div>
  );
}
