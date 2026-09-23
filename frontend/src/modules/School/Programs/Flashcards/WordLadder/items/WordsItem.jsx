import { useEffect, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useWordLadderKeys } from '../useWordLadderKeys.js';
import { wordLadderLog } from '../wordLadderLog.js';

const STATE_LABEL = {
  new: 'New', introduced: 'Just met', notYet: 'Not yet', familiar: 'Familiar', claimed: 'Got it', mastered: 'Mastered',
};

function StateChips({ word }) {
  const stars = word.state === 'mastered' ? Math.max(1, (word.stage ?? 0) + 1) : 0;
  return (
    <span className="wl-words__chips">
      <span className={`wl-chip wl-chip--${word.state}`}>
        {STATE_LABEL[word.state] ?? word.state}
        {stars > 0 && (
          <span className="wl-chip__stars" role="img" aria-label={`stage ${stars}`}>
            {Array.from({ length: stars }, (_, i) => <span key={i} className="wl-chip__star" />)}
          </span>
        )}
      </span>
      {word.tricky && <span className="wl-chip wl-chip--tricky">Tricky</span>}
    </span>
  );
}

/**
 * My words (practice menu): every word the learner can meet, with its ladder
 * state. `pick` mode multi-selects introduced words for a drill ("Drill
 * these"); otherwise it is read-only. `sittingId` always goes along — the test
 * mount reads the sitting's shadow and refuses without it.
 */
export default function WordsItem({ api, sittingId, userId, deckId, langs, pick = false, onBack, onDrill = () => {}, busy = false }) {
  const [words, setWords] = useState(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState([]);
  useEffect(() => {
    let live = true;
    (async () => {
      const { ok, status, data } = await api.words({ userId, deckId, sittingId });
      if (!live) return;
      if (!ok || !Array.isArray(data?.words)) { setFailed(true); wordLadderLog.writeFailed({ userId, what: 'words', status }); return; }
      setWords(data.words);
    })();
    return () => { live = false; };
  }, [api, userId, deckId, sittingId]);

  const toggle = (wordId) => setChosen((c) => (c.includes(wordId) ? c.filter((x) => x !== wordId) : [...c, wordId]));
  const drill = () => { if (chosen.length && !busy) onDrill(chosen); };
  useWordLadderKeys(pick ? { enter: drill } : { ' ': onBack, enter: onBack });

  const list = pick ? (words ?? []).filter((w) => w.state !== 'new') : (words ?? []);
  return (
    <section className="wl-item wl-words" aria-label={pick ? 'Pick words' : 'My words'}>
      <h2 className="wl-words__title">{pick ? 'Pick words to drill' : 'My words'}</h2>
      {failed && <p className="wl-verdict" role="alert">Your words could not be loaded right now.</p>}
      {!failed && !words && <p className="wl-loading">Loading…</p>}
      {words && (
        <div className="wl-words__grid">
          {list.map((word) => (pick ? (
            <TouchButton
              key={word.wordId}
              variant="choice"
              lang={langs.term}
              aria-pressed={chosen.includes(word.wordId)}
              className={`wl-words__word${chosen.includes(word.wordId) ? ' is-selected' : ''}`}
              onClick={() => toggle(word.wordId)}
            >
              <span className="wl-words__term" lang={langs.term}>{word.term}</span>
              <span className="wl-words__gloss" lang={langs.gloss}>{word.gloss}</span>
            </TouchButton>
          ) : (
            <div key={word.wordId} className="wl-words__word">
              <span className="wl-words__term" lang={langs.term}>{word.term}</span>
              <span className="wl-words__gloss" lang={langs.gloss}>{word.gloss}</span>
              <StateChips word={word} />
            </div>
          )))}
        </div>
      )}
      <div className="wl-controls">
        <TouchButton variant="secondary" onClick={onBack}>Back</TouchButton>
        {pick && <TouchButton variant="primary" keyHint="Enter" disabled={busy || !chosen.length} onClick={drill}>Drill these</TouchButton>}
      </div>
    </section>
  );
}
