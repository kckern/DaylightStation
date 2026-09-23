import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';

/** End of a day's sitting: the closing screen before the practice menu. */
export default function SummaryItem({ item, onExit }) {
  useWordLadderKeys({ ' ': onExit, enter: onExit });
  return (
    <section className="wl-item wl-summary" aria-label="Done">
      <h2>All done for today</h2>
      <p>{item.quizzed} {item.quizzed === 1 ? 'word' : 'words'} quizzed</p>
      <TouchButton variant="primary" keyHint="Space" onClick={onExit}>Done</TouchButton>
    </section>
  );
}
