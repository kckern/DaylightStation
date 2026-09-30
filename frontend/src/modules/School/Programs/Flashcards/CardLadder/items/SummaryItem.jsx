import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import { cardLadderLog } from '../cardLadderLog.js';
import { playScanCeremonyTone } from '../../../../selfService/scanCeremonySound.js';

/**
 * "Well done" in the language being learned, by target language code. The
 * day's last card is the child's own language cheering them before it turns
 * to English. A language with no entry here gets a single English side and no
 * turn — never a guessed translation a child would then learn.
 */
const CHEERS = Object.freeze({ ko: '잘했어요!' });

/** How long the cheer is read before the card turns to English. */
const TURN_AFTER_MS = 1200;

const reducedMotion = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * End of a day's sitting — THE MOMENT THE DAY COUNTED.
 *
 * It used to be a heading, one grey line and a row of equal buttons: on
 * 2026-09-30 the report was "a really ugly Done button, no ceremony, no
 * celebration, no obvious call to action", from a child who finished every
 * day this week and tapped Done within four seconds each time. So the day now
 * ends on a card, in the ladder's own vocabulary: the learner's language says
 * well done, the card turns (the same transform-only flip every word card
 * uses — the Portal is an FKB WebView), the success tone the scan ceremony
 * uses plays once, and Done is the one big thing to press.
 *
 * Practise more sends `{done:true}` — the server marks the summary seen and
 * answers with the practice menu. Learn more words (ruling 2026-09-23) asks
 * for one more guided round while the server says new words remain
 * (`item.learnMore`), on 2. Done closes the sitting (goal / cap) and exits on
 * Space/Enter — and on 2 when there is nothing more to learn.
 */
export default function SummaryItem({ item, langs = null, onRespond = () => {}, onLearnMore = null, onExit, busy = false }) {
  const more = () => { if (!busy) onRespond({ done: true }); };
  const canLearnMore = Number(item.learnMore) > 0 && typeof onLearnMore === 'function';
  const learnMore = () => { if (!busy) onLearnMore('summary'); };
  useCardLadderKeys({ ' ': onExit, enter: onExit, 1: more, 2: canLearnMore ? learnMore : onExit });

  const cheer = CHEERS[langs?.target] ?? null;
  const [turned, setTurned] = useState(false);
  const still = useRef(reducedMotion()).current;
  const celebrated = useRef(false);
  // Once per summary: the chime and the log line. The visible card is the
  // acknowledgement that must land; a blocked AudioContext only costs the
  // chime (the tone module never throws).
  useEffect(() => {
    if (celebrated.current) return;
    celebrated.current = true;
    const toned = playScanCeremonyTone('success');
    cardLadderLog.summaryCelebrated({ quizzed: item.quizzed ?? null, cheerLang: cheer ? langs?.target ?? null : null, toned });
  }, [cheer, item.quizzed, langs?.target]);
  // The turn is its own effect, so a remount (StrictMode, a re-render with new
  // langs) re-arms it rather than being swallowed by the once-guard above.
  useEffect(() => {
    if (!cheer) return undefined;
    const timer = setTimeout(() => setTurned(true), TURN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [cheer]);

  const words = Number(item.quizzed) || 0;
  const cardClass = ['wl-card', 'wl-summary__card', turned && 'is-flipped', still && 'wl-card--still'].filter(Boolean).join(' ');
  const english = <div className="wl-card__face wl-summary__face"><p className="wl-summary__cheer" lang={langs?.anchor ?? 'en'}>Great job!</p></div>;
  return (
    <section className="wl-item wl-summary" aria-label="Done">
      <div className={cardClass} data-testid="summary-card" role="img" aria-label="Great job!">
        <span className="wl-card__inner">
          {cheer ? (
            <>
              <span className="wl-card__side wl-card__side--up">
                <div className="wl-card__face wl-summary__face">
                  <p className="wl-summary__cheer" lang={langs.target}>{cheer}</p>
                </div>
              </span>
              <span className="wl-card__side wl-card__side--down">{english}</span>
            </>
          ) : <span className="wl-card__side wl-card__side--up">{english}</span>}
        </span>
      </div>
      <p className="wl-summary__tally">You practised {words} {words === 1 ? 'word' : 'words'} today</p>
      {/* New words were planned and none came (a catch-up day). Say so, and
          point at the one button that gets them now (2026-09-26). */}
      {item.newWordsHeld && <p className="wl-summary__held">{canLearnMore ? 'New words next time — or tap Learn more words.' : 'New words next time.'}</p>}
      <TouchButton variant="primary" keyHint="Space" className="wl-summary__done" onClick={onExit}>Done</TouchButton>
      <div className="wl-controls wl-controls--minor">
        <TouchButton variant="secondary" keyHint="1" disabled={busy} onClick={more}>Practise more</TouchButton>
        {canLearnMore && <TouchButton variant="secondary" keyHint="2" disabled={busy} onClick={learnMore}>Learn more words</TouchButton>}
      </div>
    </section>
  );
}
