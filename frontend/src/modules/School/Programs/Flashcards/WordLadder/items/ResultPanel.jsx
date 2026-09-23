import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';

const CHEERS = ['Got it!', 'Nice!', 'Yes!'];

/** A light, deterministic variation: the same item always cheers the same way. */
export function cheerFor(itemId) {
  const s = String(itemId ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHEERS[h % CHEERS.length];
}

/** A judge's note, only when it reads like something said to a child. */
function kidReadable(reason) {
  return typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 80 ? reason.trim() : null;
}

/**
 * The verdict of a graded answer (owner, 2026-09-23: "You said this, but
 * actually it's this — it needs to be much more prominent"). A large card in
 * the main area under the prompt that stays until Next — never in the button
 * row, never shaming:
 *
 *   wrong   "Not quite" (warm, not red), You typed <theirs, muted>, The answer
 *           <the correct word, large, in its own lang>, Listen (Tab).
 *   right   a short cheer (Got it! / Nice! / Yes!), the word large, Listen;
 *           a near miss (score < 10) adds "Close! It's spelled:" so a typo is
 *           still corrected.
 *
 * Announced (role=status, aria-live=polite). Enters with transform/opacity
 * only, on the shared DS keyframes and motion tokens; reduced motion: none.
 */
export default function ResultPanel({
  itemId, correct, score = null, answer, answerLang, typed = null, reason = null, audio = null, audioKind = 'term',
}) {
  const nearMiss = correct && score != null && score < 10;
  const label = correct ? (nearMiss ? "Close! It's spelled:" : null) : 'The answer';
  const note = kidReadable(reason);
  const listen = audio
    ? <TouchButton variant="secondary" keyHint="Tab" className="wl-result__listen" onClick={() => playClip(audio, audioKind)}><Icon name="volume" /> Listen</TouchButton>
    : null;
  return (
    <section
      className={`wl-result ${correct ? 'wl-result--right' : 'wl-result--wrong'}`}
      data-testid="wl-result"
      role="status"
      aria-live="polite"
      aria-label={correct ? 'Right' : 'Not quite'}
    >
      <h3 className="wl-result__heading">{correct ? cheerFor(itemId) : 'Not quite'}</h3>
      {!correct && typed && (
        <p className="wl-result__row">
          <span className="wl-result__label">You typed</span>
          <span className="wl-result__typed" lang={answerLang}>{typed}</span>
        </p>
      )}
      <div className="wl-result__row wl-result__row--answer">
        {label && <span className="wl-result__label">{label}</span>}
        <div className="wl-result__answer" lang={answerLang}><FitText role="term" text={answer ?? ''} lang={answerLang} /></div>
        {listen}
      </div>
      {note && <p className="wl-result__note">{note}</p>}
    </section>
  );
}
