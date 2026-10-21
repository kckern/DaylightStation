import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";
import { COINS_SOON } from "../../../bank/BankStrip.jsx";
import { useSchoolDebriefKeys } from "../useSchoolDebriefKeys.js";

/** What they told, how the questions went, on time or late, and what moved in this week's (preview) earnings. */
export default function SummaryItem({ view, earned = null, coinsLive = false, onFinish }) {
  useSchoolDebriefKeys({ enter: onFinish, ' ': onFinish });
  const quiz = view.summary?.quiz ?? { right: 0, graded: 0 };
  return (
    <section className="sd-item sd-summary" aria-label="Summary">
      <h2><Icon name="keep" /> Thanks for telling me about school!</h2>
      {view.entries?.learned?.text && <blockquote className="sd-summary__quote">{view.entries.learned.text}</blockquote>}
      <p>{quiz.graded ? `${quiz.right} of ${quiz.graded} questions right` : 'Questions saved'} · {view.late ? 'Late' : 'On time'}</p>
      {!coinsLive && <p className="sd-summary__soon">{COINS_SOON}</p>}
      {coinsLive && earned && earned.lines.length > 0 && (
        <ul className="sd-summary__earned">
          {earned.lines.map((l) => <li key={l.ruleId}>+{l.silver} silver{l.gems ? ` · +${l.gems} gem` : ''} · {l.label}</li>)}
          <li className="sd-summary__week">{earned.weekSilver} silver this week</li>
        </ul>
      )}
      <div className="sd-controls"><TouchButton variant="primary" keyHint="Enter" onClick={onFinish}>Done</TouchButton></div>
    </section>
  );
}
