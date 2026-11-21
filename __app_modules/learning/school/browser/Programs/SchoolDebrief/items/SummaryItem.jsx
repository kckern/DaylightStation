import { TouchButton, SectionCard, StatCard } from "../../../../../../../frontend/src/lib/ui/index.js";
import CoinIcon from "../../../../../../../frontend/src/lib/icons/CoinIcon.jsx";
import Icon from "../../../home/icons/Icon.jsx";
import { COINS_SOON } from "../../../bank/coinsSoon.js";
import { useSchoolDebriefKeys } from "../useSchoolDebriefKeys.js";
import TypedText from "../../shared/TypedText.jsx";

// The child's own words, in the order the debrief asks for them. The grader's
// `levelReason` is NOT shown here: it is the model describing the child to the
// child, and it was the line that read as a machine talking (owner, 2026-11-20).
const OWN_WORDS = ['moment', 'teach', 'learned', 'hard', 'notable'];

/**
 * The finished day: the week's silver when the bank is live (the one
 * emphasized stat), what the child said in their own words, and what the
 * debrief recognised in it. One Done; no inferred payout. No score: the quiz
 * line was dropped on purpose (ca0f29a6fa, 2026-11-09), and no level number
 * is ever shown to the child.
 * `coinsLive`: true (bank live), false (show "Coins start soon"), null (bank not read yet: show neither).
 */
export default function SummaryItem({ view, earned = null, coinsLive = false, onFinish }) {
  useSchoolDebriefKeys({ enter: onFinish, ' ': onFinish });
  const words = OWN_WORDS.map((id) => view.entries?.[id]?.text).find((t) => typeof t === 'string' && t.trim());
  const silver = coinsLive && earned && Number.isFinite(earned.weekSilver) ? earned.weekSilver : null;
  const recognised = [
    view.summary?.rich && 'You told me a real moment',
    view.summary?.teachable && 'You explained it so someone could try it',
  ].filter(Boolean);

  return (
    <section className="sd-item sd-summary" aria-label="Summary">
      <header className="sd-summary__head">
        <span className="sd-summary__mark" aria-hidden="true"><Icon name="check" /></span>
        <h2 className="sd-summary__title"><TypedText text="Thanks for telling me about school!" /></h2>
        <span className={`sd-pill${view.late ? ' is-late' : ''}`}>{view.late ? 'Late' : 'On time'}</span>
      </header>

      <div className="sd-summary__stats">
        {silver !== null && (
          <div className="sd-stat" role="group" aria-label={`${silver} silver this week`}>
            <StatCard emphasis label="Weekly earnings preview" value={<><CoinIcon metal="silver" size="0.9em" className="sd-stat__coin" />{silver}</>} unit="silver this week" />
          </div>
        )}
        {coinsLive === false && (
          <div className="sd-stat sd-stat--soon" role="group" aria-label="Coins">
            <StatCard label="Coins" value={<CoinIcon metal="silver" size="0.9em" className="sd-stat__coin" />} trend={COINS_SOON} />
          </div>
        )}
      </div>

      {words && (
        <SectionCard title="What you told me" className="sd-summary__words">
          <blockquote className="sd-summary__quote">{words}</blockquote>
        </SectionCard>
      )}

      {recognised.length > 0 && (
        <ul className="sd-badges" aria-label="What you did well">
          {recognised.map((text) => <li key={text} className="sd-badge"><Icon name="check" /> {text}</li>)}
        </ul>
      )}

      <div className="sd-controls"><TouchButton variant="primary" keyHint="Enter" onClick={onFinish}>Done</TouchButton></div>
    </section>
  );
}
