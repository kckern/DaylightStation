/**
 * Repair — when people or tech fail (spec §4.2), fully live as of wave 5:
 * the delivered-feedback read + standalone note composer (D3), attestation
 * overrides (D2), and attribution repair (D1).
 */
import { useState } from 'react';
import FeedbackNotes, { NoteComposer } from '../panels/FeedbackNotes.jsx';
import AttestationPanel from '../panels/AttestationPanel.jsx';
import ReassignPanel from '../panels/ReassignPanel.jsx';

export default function RepairTab({ learnerId, kids = [] }) {
  const learnerName = kids.find((k) => k.id === learnerId)?.name ?? null;
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  if (!learnerId) {
    return (
      <div className="teacher-tab teacher-tab--repair">
        <p className="teacher-panel__empty">Pick a learner above to see their feedback and repairs.</p>
      </div>
    );
  }
  return (
    <div className="teacher-tab teacher-tab--repair">
      <FeedbackNotes key={feedbackRefresh} learnerId={learnerId} learnerName={learnerName} />
      <NoteComposer learnerId={learnerId} learnerName={learnerName} onSent={() => setFeedbackRefresh((n) => n + 1)} />
      <AttestationPanel learnerId={learnerId} learnerName={learnerName} />
      <ReassignPanel learnerId={learnerId} learnerName={learnerName} kids={kids} />
    </div>
  );
}
