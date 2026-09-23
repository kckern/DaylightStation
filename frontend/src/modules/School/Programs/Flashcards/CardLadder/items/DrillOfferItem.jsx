import { useEffect } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../cardLadderAudio.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import { cardLadderLog } from '../cardLadderLog.js';

/**
 * End-of-round drill offer (spec §3): a word missed this round, offered for a
 * walk-through now. Never forced — Not now is as big as Practise.
 */
export default function DrillOfferItem({ item, langs, resolveAssetUrl, onRespond, busy = false, onLayout }) {
  const word = item.word ?? {};
  const audio = word.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  useEffect(() => { if (audio) playClip(audio, 'term', { trigger: 'auto' }); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (accepted) => {
    if (busy) return;
    cardLadderLog.drillOffered({ itemId: item.id, wordId: item.wordId ?? word.wordId ?? null, accepted });
    onRespond({ drill: accepted ? 'yes' : 'no' });
  };
  const hear = () => audio && playClip(audio, 'term');
  useCardLadderKeys({ 1: () => answer(true), 2: () => answer(false), tab: hear, h: hear });
  return (
    <section className="wl-item wl-offer" aria-label="Tricky word">
      <h2 className="wl-offer__title">This one&apos;s tricky — want to practise it?</h2>
      <div className="wl-prompt">
        <FitText role="term" text={word.term ?? ''} lang={langs.target} onFit={onLayout} />
      </div>
      <div className="wl-controls">
        {audio && <TouchButton variant="secondary" keyHint="Tab" onClick={hear}><Icon name="volume" /> Hear it</TouchButton>}
        <TouchButton variant="primary" keyHint="1" disabled={busy} onClick={() => answer(true)}>Practise</TouchButton>
        <TouchButton variant="secondary" keyHint="2" disabled={busy} onClick={() => answer(false)}>Not now</TouchButton>
      </div>
    </section>
  );
}
