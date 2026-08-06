/**
 * Records — grades, mastery, printouts (spec §4.2). Live panels land in
 * Task 12; the tab carries its four stubs from day one.
 */
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function RecordsTab({ learnerId }) {
  return (
    <div className="teacher-tab teacher-tab--records">
      <StubCard todoId={TODO.PERIOD_CLOSE} />
      <StubCard todoId={TODO.PROGRESSREPORT_PRINT} />
      <StubCard todoId={TODO.CERTIFICATES_PRINT} />
      <StubCard todoId={TODO.ENRICHMENT_CREDIT} />
    </div>
  );
}
