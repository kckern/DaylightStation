import { TouchButton } from "../../../../../../../frontend/src/lib/ui/index.js";
import Icon from "../../../home/icons/Icon.jsx";
import { COINS_SOON } from "../../../bank/coinsSoon.js";
import { useSchoolDebriefKeys } from "../useSchoolDebriefKeys.js";

/** Debrief result plus the bank's weekly earnings preview; no inferred payout. */
/** `coinsLive`: true (bank live), false (show "Coins start soon"), null (bank not read yet: show neither). */
export default function SummaryItem({ view, earned = null, coinsLive = false, onFinish }) {
  useSchoolDebriefKeys({ enter: onFinish, ' ': onFinish });
  const reason = view.summary?.levelReason || view.entries?.teach?.text || view.entries?.learned?.text;
  return (
    <section className="sd-item sd-summary" aria-label="Summary">
      <h2><Icon name="keep" /> Thanks for telling me about school!</h2>
      {reason && <blockquote className="sd-summary__quote">{reason}</blockquote>}
      {view.summary?.rich && <p className="sd-summary__reason">You told me a real moment</p>}
      {view.summary?.teachable && <p className="sd-summary__reason">You explained it so someone could try it</p>}
      <p>{view.late ? 'Late' : 'On time'}</p>
      {coinsLive === false && <p className="sd-summary__soon">{COINS_SOON}</p>}
      {coinsLive && earned && Number.isFinite(earned.weekSilver) && (
        <div className="sd-summary__earned">
          <p>Weekly earnings preview</p>
          <p className="sd-summary__week">{earned.weekSilver} silver this week</p>
        </div>
      )}
      <div className="sd-controls"><TouchButton variant="primary" keyHint="Enter" onClick={onFinish}>Done</TouchButton></div>
    </section>
  );
}
