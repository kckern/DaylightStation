import { useEffect, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import { cardLadderLog } from '../cardLadderLog.js';

const STATE_LABEL = {
  new: 'New', introduced: 'Just met', notYet: 'Not yet', familiar: 'Familiar', claimed: 'Got it', mastered: 'Mastered',
};

/**
 * Ruling 2026-09-23: "Mastered" means signed off by a typed recheck. A word
 * the quiz verified but typing has not yet signed off reads "Recognised".
 * The server's `level` says which; an older server (no `level`) keeps the
 * raw-state label.
 */
function labelOf(word) {
  if (word.state === 'mastered' && word.level === 'recognised') return 'Recognised';
  return STATE_LABEL[word.state] ?? word.state;
}

function StateChips({ word }) {
  const stars = word.state === 'mastered' ? Math.max(1, (word.stage ?? 0) + 1) : 0;
  return (
    <span className="wl-words__chips">
      <span className={`wl-chip wl-chip--${word.state}`}>
        {labelOf(word)}
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
  // Keyboard cursor over the pick grid: arrows move it, Space toggles the word under it.
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      const { ok, status, data } = await api.words({ userId, deckId, sittingId });
      if (!live) return;
      if (!ok || !Array.isArray(data?.words)) { setFailed(true); cardLadderLog.wordsFailed({ userId, deckId, sittingId, status }); return; }
      setWords(data.words);
    })();
    return () => { live = false; };
  }, [api, userId, deckId, sittingId]);

  const toggle = (wordId) => setChosen((c) => (c.includes(wordId) ? c.filter((x) => x !== wordId) : [...c, wordId]));
  const drill = () => { if (chosen.length && !busy) onDrill(chosen); };
  const list = pick ? (words ?? []).filter((w) => w.state !== 'new') : (words ?? []);
  const at = Math.min(cursor, Math.max(0, list.length - 1));
  const move = (by) => setCursor(() => (list.length ? (((at + by) % list.length) + list.length) % list.length : 0));
  useCardLadderKeys(pick
    ? {
      enter: drill,
      ' ': () => list[at] && toggle(list[at].wordId),
      // The grid is four across: up/down move a row.
      arrowright: () => move(1), arrowleft: () => move(-1), arrowdown: () => move(4), arrowup: () => move(-4),
      backspace: onBack,
    }
    : { ' ': onBack, enter: onBack, backspace: onBack });
  const grid = useRef(null);
  useEffect(() => { grid.current?.querySelector('.is-cursor')?.scrollIntoView?.({ block: 'nearest' }); }, [at, pick]);

  return (
    <section className="wl-item wl-words" aria-label={pick ? 'Pick words' : 'My words'}>
      <h2 className="wl-words__title">{pick ? 'Pick words to drill' : 'My words'}</h2>
      {failed && <p className="wl-verdict" role="alert">Your words could not be loaded right now.</p>}
      {!failed && !words && <p className="wl-loading">Loading…</p>}
      {words && (
        <div className="wl-words__grid" ref={grid}>
          {list.map((word) => (pick ? (
            <TouchButton
              key={word.wordId}
              variant="choice"
              lang={langs.target}
              aria-pressed={chosen.includes(word.wordId)}
              keyHint={list[at]?.wordId === word.wordId ? 'Space' : null}
              className={`wl-words__word${chosen.includes(word.wordId) ? ' is-selected' : ''}${list[at]?.wordId === word.wordId ? ' is-cursor' : ''}`}
              onClick={() => toggle(word.wordId)}
            >
              <span className="wl-words__term" lang={langs.target}>{word.term}</span>
              <span className="wl-words__gloss" lang={langs.anchor}>{word.gloss}</span>
            </TouchButton>
          ) : (
            <div key={word.wordId} className="wl-words__word">
              <span className="wl-words__term" lang={langs.target}>{word.term}</span>
              <span className="wl-words__gloss" lang={langs.anchor}>{word.gloss}</span>
              <StateChips word={word} />
            </div>
          )))}
        </div>
      )}
      <div className="wl-controls">
        <TouchButton variant="secondary" keyHint={pick ? '⌫' : 'Space'} onClick={onBack}>Back</TouchButton>
        {pick && <TouchButton variant="primary" keyHint="Enter" disabled={busy || !chosen.length} onClick={drill}>Drill these</TouchButton>}
      </div>
    </section>
  );
}
