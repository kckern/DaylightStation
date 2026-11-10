import { TouchButton } from "../../../../../../../../frontend/src/lib/ui/index.js";
import { useCardLadderKeys } from "../useCardLadderKeys.js";

/**
 * The end of a weekly-dictation run (spec 2026-11-06, UX audit #4): an
 * explicit screen, never a ladder item by surprise. "Ready" only when every
 * word of the week was written blind twice AND none is waiting on a grown-up
 * (audit #5) — otherwise it says which words still need one. Done
 * acknowledges it; the server then serves the sitting's own ladder again.
 */
export default function DictationReadyItem({ item, onRespond, busy = false }) {
  const finish = () => { if (!busy) onRespond({ done: true }); };
  useCardLadderKeys({ ' ': finish, enter: finish });
  const waiting = [...(item.needsRecording ?? []), ...(item.unknown ?? [])];
  // The whole week, waiting words included (final review M6).
  const total = (item.wordCount ?? 0) + waiting.length;
  return (
    <section className="wl-item wl-dictation-ready" aria-label="Dictation">
      {item.ready
        ? <p className="wl-dictation-ready__title">Dictation ready ✓</p>
        : <p className="wl-dictation-ready__title">{item.wordsDone} of {total} words done</p>}
      {item.ready && <p className="wl-dictation-ready__line">You can write all {item.wordCount} words from sound.</p>}
      {(item.needsRecording ?? []).length > 0 && (
        <p className="wl-dictation-ready__line">{item.needsRecording.length === 1 ? 'One word needs its recording' : `${item.needsRecording.length} words need their recordings`} — a grown-up will add it.</p>
      )}
      {(item.unknown ?? []).length > 0 && (
        <p className="wl-dictation-ready__line">{item.unknown.length === 1 ? 'One word is not in your deck yet' : `${item.unknown.length} words are not in your deck yet`} — a grown-up will add it.</p>
      )}
      <div className="wl-controls">
        <TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={finish}>Done</TouchButton>
      </div>
    </section>
  );
}
