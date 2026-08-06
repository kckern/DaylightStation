/**
 * Repair — when people or tech fail (spec §4.2). Live panels land in
 * Task 13; the tab carries its three stubs from day one.
 */
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function RepairTab({ learnerId }) {
  return (
    <div className="teacher-tab teacher-tab--repair">
      <StubCard todoId={TODO.ATTESTATION} />
      <StubCard todoId={TODO.REASSIGN} />
      <StubCard todoId={TODO.NOTES_STANDALONE} />
    </div>
  );
}
