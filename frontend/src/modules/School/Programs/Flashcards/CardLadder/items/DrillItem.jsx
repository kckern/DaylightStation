import { useEffect, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../cardLadderAudio.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import TypedItem from './TypedItem.jsx';
import SayItem from './SayItem.jsx';
import MatchItem from './MatchItem.jsx';
import TilesItem from './TilesItem.jsx';

/** Steps that test recall of the term: it is never on screen before the answer. */
const HIDES_TERM = new Set(['dictation', 'tiles', 'type', 'say-from-cue']);
const SAY_STEPS = new Set(['say-after', 'read-aloud', 'say-from-cue']);

/** "look": the one place picture, term, sound and meaning appear together. */
function LookStep({ item, langs, resolveAssetUrl, onRespond, busy, onLayout }) {
  const word = item.word ?? {};
  const audio = word.media?.audio ? resolveAssetUrl(word.media.audio) : null;
  const image = word.media?.image ? resolveAssetUrl(word.media.image) : null;
  const [imageOk, setImageOk] = useState(true);
  useEffect(() => { if (audio) playClip(audio, 'term', { trigger: 'auto' }); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { if (!busy) onRespond({ done: true }); };
  const hear = () => audio && playClip(audio, 'term');
  useCardLadderKeys({ ' ': next, enter: next, tab: hear, h: hear });
  return (
    <section className="wl-item wl-look" aria-label="Look">
      <div className={`wl-card wl-look__card${image && imageOk ? ' has-picture' : ''}`}>
        {image && imageOk && <img className="wl-card__picture" src={image} alt={word.gloss ?? ''} onError={() => setImageOk(false)} />}
        <div className="wl-look__words">
          <FitText role="term" text={word.term ?? ''} lang={langs.term} onFit={onLayout} />
          <FitText role="gloss" text={word.gloss ?? ''} lang={langs.gloss} />
        </div>
      </div>
      <div className="wl-controls">
        {audio && <TouchButton variant="secondary" keyHint="Tab" onClick={hear}><Icon name="volume" /> Hear it</TouchButton>}
        <TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={next}>Next</TouchButton>
      </div>
    </section>
  );
}

/** A step this client does not know yet: never a dead end — Continue moves on (Space, never "Skip"). */
function UnknownStep({ onRespond, busy }) {
  const advance = () => { if (!busy) onRespond({ done: true }); };
  useCardLadderKeys({ ' ': advance, enter: advance });
  return (
    <section className="wl-item" aria-label="Step not ready">
      <p className="wl-verdict">This step isn&apos;t ready on this screen yet.</p>
      <div className="wl-controls"><TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={advance}>Continue</TouchButton></div>
    </section>
  );
}

/**
 * One step of a drill (spec §3 drill path): one word walked from full support
 * to none. The header names the word only on steps where it is already on
 * screen; recall steps (dictation / tiles / type / say-from-cue) carry no term
 * from the server and show none here either. Each step delegates to the item
 * that already renders that task.
 */
export default function DrillItem({
  item, langs, resolveAssetUrl, onRespond, result = null, pending = false, onContinue, busy = false,
  api, sittingId, userId, stageRef = null, onLayout,
}) {
  const { step } = item;
  const term = HIDES_TERM.has(step) ? null : item.word?.term ?? null;
  const common = { item, langs, resolveAssetUrl, onRespond, result, onContinue, busy, onLayout };
  let body;
  if (step === 'look') body = <LookStep {...common} />;
  else if (step === 'copy') body = <TypedItem {...common} mode="copy" />;
  else if (step === 'dictation') body = <TypedItem {...common} mode="dictation" pending={pending} />;
  else if (step === 'type') body = <TypedItem {...common} mode="practice" stageRef={stageRef} />;
  else if (SAY_STEPS.has(step)) body = <SayItem {...common} mode={step} api={api} sittingId={sittingId} userId={userId} />;
  else if (step === 'match') body = <MatchItem {...common} />;
  else if (step === 'tiles') body = <TilesItem {...common} pending={pending} />;
  else body = <UnknownStep {...common} />;
  const of = item.of ?? 0;
  return (
    <section className="wl-drill" aria-label="Drill">
      <header className="wl-drill__header">
        <p className="wl-drill__title">
          Practising{term ? <> <span lang={langs.term}>{term}</span></> : ' a word'}
        </p>
        <p className="wl-drill__steps">
          <span className="wl-drill__dots" aria-hidden="true">
            {Array.from({ length: of }, (_, i) => <span key={i} className={`wl-drill__dot${i < item.at - 1 ? ' is-done' : ''}${i === item.at - 1 ? ' is-current' : ''}`} />)}
          </span>
          <span className="wl-drill__count">Step {item.at} of {of}</span>
        </p>
      </header>
      <div className="wl-drill__body">{body}</div>
    </section>
  );
}
