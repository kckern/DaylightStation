/**
 * Today — roster-scoped daily loop (spec §4.2). Live panels land in Task 10;
 * the tab carries its three mutation stubs from day one.
 */
import StubCard from '../panels/StubCard.jsx';
import { TODO } from '../todoRegistry.js';

export default function TodayTab({ kids }) {
  return (
    <div className="teacher-tab teacher-tab--today">
      <StubCard todoId={TODO.REVIEW_RESOLVE} />
      <StubCard todoId={TODO.PRINT_DECIDE} />
      <StubCard todoId={TODO.QUIZREQUESTS_CLEAR} />
    </div>
  );
}
