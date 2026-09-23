import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';

/**
 * End of a day's sitting. Practise more sends `{done:true}` — the server marks
 * the summary seen and answers with the practice menu. Learn more words
 * (ruling 2026-09-23) asks for one more guided round while the server says new
 * words remain (`item.learnMore`), on 2. Done closes the sitting (goal / cap)
 * and exits on Space/Enter — and on 2 when there is nothing more to learn.
 */
export default function SummaryItem({ item, onRespond = () => {}, onLearnMore = null, onExit, busy = false }) {
  const more = () => { if (!busy) onRespond({ done: true }); };
  const canLearnMore = Number(item.learnMore) > 0 && typeof onLearnMore === 'function';
  const learnMore = () => { if (!busy) onLearnMore('summary'); };
  useCardLadderKeys({ ' ': onExit, enter: onExit, 1: more, 2: canLearnMore ? learnMore : onExit });
  return (
    <section className="wl-item wl-summary" aria-label="Done">
      <h2>All done for today</h2>
      <p>{item.quizzed} {item.quizzed === 1 ? 'word' : 'words'} quizzed</p>
      <div className="wl-controls">
        <TouchButton variant="secondary" keyHint="1" disabled={busy} onClick={more}>Practise more</TouchButton>
        {canLearnMore && <TouchButton variant="secondary" keyHint="2" disabled={busy} onClick={learnMore}>Learn more words</TouchButton>}
        <TouchButton variant="primary" keyHint="Space" onClick={onExit}>Done</TouchButton>
      </div>
    </section>
  );
}
