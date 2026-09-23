import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import Icon from '../../../../home/icons/Icon.jsx';
import { FitGroup, FitText } from '../FitText.jsx';
import { playClip } from '../cardLadderAudio.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import AnchorCue, { anchorCueAudio } from './AnchorCue.jsx';
import ResultPanel from './ResultPanel.jsx';

/**
 * 2.2 pick-meaning (hear | read) and 3.1 pick-term (cue → Korean). Graded
 * server-side. The 2.2 `hear` prompt IS the term — the answer — so it must
 * never render before a result exists; only the speaker button shows.
 */
export default function ChoiceItem({ item, langs, resolveAssetUrl, onRespond, result = null, onContinue, busy = false }) {
  const audio = item.assets?.audio ? resolveAssetUrl(item.assets.audio) : null;
  const glossAudio = item.task === '3.1' ? anchorCueAudio(item, resolveAssetUrl) : null;
  const choicesLang = item.task === '2.2' ? langs.gloss : langs.term;
  useEffect(() => {
    if (item.channel === 'hear' && audio) playClip(audio, 'term', { trigger: 'auto' });
    if (item.cue?.type === 'audio' && glossAudio) playClip(glossAudio, 'gloss', { trigger: 'auto' });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Spec §6: "wrong / Don't know → the correct answer with Korean audio."
  // Plays once per item's result, not on every re-render the result stays set for.
  const playedWrongFor = useRef(null);
  useEffect(() => {
    if (result && result.correct === false && audio && playedWrongFor.current !== item.id) {
      playedWrongFor.current = item.id;
      playClip(audio, 'term', { trigger: 'auto' });
    }
  }, [result, audio, item.id]);
  // The option the child picked, so a wrong result can show it beside the answer.
  const [chosen, setChosen] = useState(null);
  useEffect(() => { setChosen(null); }, [item.id]);
  const choose = (choice) => { if (!busy && !result) { setChosen(choice); onRespond({ choice }); } };
  // The result's Listen: the revealed Korean (3.1 — the server sends its clip
  // with the result), else the term the 2.2 prompt already carried.
  const answerAudio = result?.audio ? resolveAssetUrl(result.audio) : audio;
  // Tab = hear it again (H stays a silent alias — this is not a typing item).
  const hear = result
    ? () => (answerAudio ? playClip(answerAudio, 'term') : glossAudio && playClip(glossAudio, 'gloss'))
    : () => (audio ?? glossAudio) && playClip(audio ?? glossAudio, audio ? 'term' : 'gloss');
  const keys = result
    ? { ' ': onContinue, enter: onContinue, tab: hear, h: hear }
    : {
      0: () => !busy && onRespond({ dontKnow: true }),
      tab: hear,
      h: hear,
      ...Object.fromEntries(item.choices.map((c, i) => [String(i + 1), () => choose(c)])),
    };
  useCardLadderKeys(keys);
  return (
    <section className="wl-item wl-choice" aria-label={item.source === 'recheck' ? 'Check' : 'Quiz'}>
      <div className="wl-prompt">
        {item.task === '2.2' && item.channel === 'read' && <FitText role="prompt" text={item.prompt} lang={langs.term} />}
        {item.task === '2.2' && item.channel === 'hear' && (
          result
            ? <FitText role="prompt" text={item.prompt} lang={langs.term} />
            : <TouchButton variant="secondary" keyHint="Tab" onClick={() => audio && playClip(audio, 'term')}><Icon name="volume" /> Listen</TouchButton>
        )}
        {item.task === '3.1' && <AnchorCue item={item} resolveAssetUrl={resolveAssetUrl} lang={langs.gloss} keyHint={result && answerAudio ? null : 'Tab'} />}
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
              className={[result && choice === result.answer && 'is-answer', result && choice === chosen && choice !== result.answer && 'is-chosen'].filter(Boolean).join(' ')}
              onClick={() => choose(choice)}
            >
              <FitText role="choice" text={choice} lang={choicesLang} />
            </TouchButton>
          ))}
        </div>
      </FitGroup>
      {result && (
        <ResultPanel
          itemId={item.id}
          correct={Boolean(result.correct)}
          score={result.score ?? null}
          answer={result.answer}
          answerLang={choicesLang}
          reason={result.reason ?? null}
          audio={answerAudio}
        />
      )}
      <div className={`wl-controls${result ? ' has-result' : ''}`}>
        {!result && <TouchButton variant="secondary" keyHint="0" disabled={busy} onClick={() => onRespond({ dontKnow: true })}>Don&apos;t know</TouchButton>}
        {result && <TouchButton variant="primary" keyHint="Space" onClick={onContinue}>Next</TouchButton>}
      </div>
    </section>
  );
}
