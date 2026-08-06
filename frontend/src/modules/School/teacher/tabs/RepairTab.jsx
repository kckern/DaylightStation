/**
 * Repair — when people or tech fail (spec §4.2): the delivered-feedback read,
 * plus the attestation-override and attribution-repair stubs (new evidence
 * kinds, wave 5).
 */
import FeedbackNotes from '../panels/FeedbackNotes.jsx';
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function RepairTab({ learnerId, kids = [] }) {
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? null;
  return (
    <div className="teacher-tab teacher-tab--repair">
      {learnerId ? (
        <FeedbackNotes learnerId={learnerId} learnerName={learnerName} />
      ) : (
        <p className="teacher-panel__empty">Pick a learner above to see their feedback.</p>
      )}
      <StubCard todoId={TODO.NOTES_STANDALONE} />
      <StubCard todoId={TODO.ATTESTATION} />
      <StubCard todoId={TODO.REASSIGN} />
    </div>
  );
}
