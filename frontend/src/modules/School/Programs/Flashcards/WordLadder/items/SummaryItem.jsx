import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

/**
 * End of a day's sitting. Practise more sends `{done:true}` — the server marks
 * the summary seen and answers with the practice menu. Done closes the sitting
 * (goal / cap) and exits, as before.
 */
export default function SummaryItem({ item, onRespond = () => {}, onExit, busy = false }) {
  const more = () => { if (!busy) onRespond({ done: true }); };
  useWordLadderKeys({ ' ': onExit, enter: onExit, 1: more, 2: onExit });
  return (
    <section className="wl-item wl-summary" aria-label="Done">
      <h2>All done for today</h2>
      <p>{item.quizzed} {item.quizzed === 1 ? 'word' : 'words'} quizzed</p>
      <div className="wl-controls">
        <TouchButton variant="secondary" keyHint="1" disabled={busy} onClick={more}>Practise more</TouchButton>
        <TouchButton variant="primary" keyHint="Space" onClick={onExit}>Done</TouchButton>
      </div>
    </section>
  );
}
