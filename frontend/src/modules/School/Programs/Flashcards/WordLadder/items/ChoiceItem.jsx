import { useEffect, useRef } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitGroup, FitText } from '../FitText.jsx';
import { playClip } from '../wordLadderAudio.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import CuePicture from './CuePicture.jsx';

/**
 * 2.2 pick-meaning (hear | read) and 3.1 pick-term (cue → Korean). Graded
 * server-side. The 2.2 `hear` prompt IS the term — the answer — so it must
 * never render before a result exists; only the speaker button shows.
 */
export default function ChoiceItem({ item, langs, resolveAssetUrl, onRespond, result = null, onContinue, busy = false }) {
  const audio = item.assets?.audio ? resolveAssetUrl(item.assets.audio) : null;
  const glossAudio = item.assets?.glossAudio ? resolveAssetUrl(item.assets.glossAudio) : null;
  const image = item.assets?.image ? resolveAssetUrl(item.assets.image) : null;
  const choicesLang = item.task === '2.2' ? langs.gloss : langs.term;
  useEffect(() => {
    if (item.channel === 'hear' && audio) playClip(audio);
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Spec §6: "wrong / Don't know → the correct answer with Korean audio."
  // Plays once per item's result, not on every re-render the result stays set for.
  const playedWrongFor = useRef(null);
  useEffect(() => {
    if (result && result.correct === false && audio && playedWrongFor.current !== item.id) {
      playedWrongFor.current = item.id;
      playClip(audio);
    }
  }, [result, audio, item.id]);
  const choose = (choice) => { if (!busy && !result) onRespond({ choice }); };
  const keys = result
    ? { ' ': onContinue, enter: onContinue, h: () => audio && playClip(audio) }
    : {
      0: () => !busy && onRespond({ dontKnow: true }),
      h: () => (audio ?? glossAudio) && playClip(audio ?? glossAudio),
      ...Object.fromEntries(item.choices.map((c, i) => [String(i + 1), () => choose(c)])),
    };
  useWordLadderKeys(keys);
  return (
    <section className="wl-item wl-choice" aria-label={item.source === 'recheck' ? 'Check' : 'Quiz'}>
      <div className="wl-prompt">
        {item.task === '2.2' && item.channel === 'read' && <FitText role="prompt" text={item.prompt} lang={langs.term} />}
        {item.task === '2.2' && item.channel === 'hear' && (
          result
            ? <FitText role="prompt" text={item.prompt} lang={langs.term} />
            : <TouchButton variant="secondary" keyHint="H" onClick={() => audio && playClip(audio)}><Icon name="volume" /> Listen</TouchButton>
        )}
        {item.task === '3.1' && item.cue?.type === 'image' && <CuePicture item={item} src={image} lang={langs.gloss} />}
        {item.task === '3.1' && item.cue?.type === 'text' && <FitText role="prompt" text={item.cue.text} lang={langs.gloss} />}
        {item.task === '3.1' && item.cue?.type === 'audio' && <TouchButton variant="secondary" keyHint="H" onClick={() => glossAudio && playClip(glossAudio)}><Icon name="volume" /> Listen</TouchButton>}
      </div>
      <FitGroup>
        <div className="wl-choices" role="group" aria-label="Choices">
          {item.choices.map((choice, i) => (
            <TouchButton
              key={choice}
              variant="choice"
              keyHint={String(i + 1)}
              lang={choicesLang}
              disabled={busy || Boolean(result)}
              className={result && choice === result.answer ? 'is-answer' : ''}
              onClick={() => choose(choice)}
            >
              <FitText role="choice" text={choice} lang={choicesLang} />
            </TouchButton>
          ))}
        </div>
      </FitGroup>
      <div className="wl-controls">
        {!result && <TouchButton variant="secondary" keyHint="0" disabled={busy} onClick={() => onRespond({ dontKnow: true })}>Don&apos;t know</TouchButton>}
        {result && <p className="wl-verdict" role="status">{result.correct ? 'Right!' : `It's ${result.answer}`}</p>}
        {result && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
    </section>
  );
}
