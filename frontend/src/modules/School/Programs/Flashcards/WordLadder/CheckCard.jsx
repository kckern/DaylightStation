import { useEffect, useState } from 'react';
import Icon from '../../../home/icons/Icon.jsx';
import { Picture, WordFace } from './StudyCard.jsx';
import { playClip } from './wordLadderAudio.js';

/** One graded check. The server grades; this only shows the prompt, the four choices, and the result. */
export default function CheckCard({
  item, result = null, langs = {}, resolveAssetUrl = (id) => id, onAnswer = async () => {}, onContinue = () => {},
}) {
  const [busy, setBusy] = useState(false);
  // The prompt is the term for term_to_gloss; any "*_to_term" direction asks
  // for the term in the choices, so the prompt is not the term there.
  const choicesTerm = typeof item.direction === 'string' && item.direction.endsWith('_to_term');
  const promptTerm = !choicesTerm;
  const langOf = (isTerm) => (isTerm ? langs.term : langs.gloss) ?? undefined;
  const promptUrl = item.prompt?.assetId ? resolveAssetUrl(item.prompt.assetId) : null;
  useEffect(() => {
    setBusy(false);
    if (!result && item.prompt?.type === 'audio' && promptUrl) playClip(promptUrl);
  // Once per check; a result for the same item must not replay the prompt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.wordId, item.phase]);
  const choose = async (choice) => {
    if (busy || result) return;
    setBusy(true);
    await onAnswer(item, choice);
    setBusy(false);
  };
  return (
    <section className="word-ladder-card word-ladder-check" aria-label={item.phase === 'review' ? 'Review quiz' : 'Check'}>
      <div className="word-ladder-prompt">
        {item.prompt?.type === 'image' && <Picture src={promptUrl} alt="Picture" />}
        {item.prompt?.type === 'audio' && (
          <button type="button" className="word-ladder-hear" onClick={() => playClip(promptUrl)}><Icon name="volume" /> Hear it</button>
        )}
        {item.prompt?.type === 'text' && (
          <p className={promptTerm ? 'word-ladder-term' : 'word-ladder-gloss'} lang={langOf(promptTerm)}>{item.prompt.text}</p>
        )}
      </div>
      <div className="word-ladder-choices" role="group" aria-label="Choices">
        {item.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={busy || Boolean(result)}
            lang={langOf(choicesTerm)}
            className={`word-ladder-choice${result && choice === result.answer ? ' is-answer' : ''}`}
            onClick={() => choose(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      {result?.correct === true && <p className="word-ladder-tick" role="status"><Icon name="keep" /> Right!</p>}
      {result?.correct === false && (
        <div className="word-ladder-correction" role="status">
          <p>Not quite. Here is the card:</p>
          <WordFace card={result.card} langs={langs} resolveAssetUrl={resolveAssetUrl} />
          <p className="word-ladder-gloss" lang={langOf(false)}>{result.card.gloss}</p>
        </div>
      )}
      {result && <button type="button" className="word-ladder-next" onClick={onContinue}><Icon name="next" /> Next</button>}
    </section>
  );
}
