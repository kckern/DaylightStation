import { useEffect, useMemo, useRef, useState } from 'react';
import { TouchButton } from '../../../../../../lib/ui/index.js';
import { FitText } from '../FitText.jsx';
import { useCardLadderKeys } from '../useCardLadderKeys.js';
import { cardLadderLog } from '../cardLadderLog.js';

const WRONG_FLASH_MS = 600;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The server sends the board's pairs PRE-JOINED (each pair carries its own
 * right side), so rendering the right column in pair order would put every
 * answer beside its term. This shuffles it independently — seeded by the item
 * id, so a re-render never reshuffles — and never leaves it in pair order
 * (a pair or two may still land level by chance, as with any shuffle).
 */
export function shuffledRight(pairs, seed) {
  const order = pairs.map((_, i) => i);
  let s = hash(String(seed)) || 1;
  for (let i = order.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && order.every((v, i) => v === i)) {
    // Came out in pair order — every answer beside its term: rotate by one.
    return pairs.map((_, i) => (i + 1) % pairs.length);
  }
  return order;
}

function RightFace({ pair, resolveAssetUrl, lang }) {
  const [failed, setFailed] = useState(false);
  const { right } = pair;
  if (right?.type === 'image' && right.image && !failed) {
    return <img className="wl-match__picture" src={resolveAssetUrl(right.image)} alt={right.text ?? ''} onError={() => setFailed(true)} />;
  }
  return <FitText role="choice" text={right?.text ?? ''} lang={lang} />;
}

/**
 * 2.3 match (practice run or drill step): Korean terms on the left, pictures or
 * English on the right. Tap a term, then its partner; a right pair locks, a
 * wrong one flashes. Client-side only — nothing is graded — and Next sends
 * `{done:true}` once every pair is locked.
 *
 * Keyboard: both columns carry digit hints (boards are at most 6 rows). With
 * no word selected, digit n selects row n on the LEFT; with one selected,
 * digit n answers with row n on the RIGHT.
 */
export default function MatchItem({ item, langs, resolveAssetUrl, onRespond, busy = false }) {
  const pairs = item.board?.pairs ?? [];
  const order = useMemo(() => shuffledRight(pairs, item.id), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState(null);
  const [matched, setMatched] = useState(() => new Set());
  const [wrong, setWrong] = useState(null);
  const misses = useRef(0);
  const startedAt = useRef(Date.now());
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const complete = pairs.length > 0 && matched.size === pairs.length;

  const pickRight = (wordId) => {
    if (selected === null || matched.has(wordId)) return;
    if (wordId === selected) {
      const next = new Set(matched); next.add(wordId);
      setMatched(next); setSelected(null);
      if (next.size === pairs.length) {
        cardLadderLog.matchCompleted({ itemId: item.id, ms: Date.now() - startedAt.current, misses: misses.current, pairs: pairs.length });
      }
      return;
    }
    misses.current += 1;
    setWrong(wordId); setSelected(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setWrong(null), WRONG_FLASH_MS);
  };
  const pickLeft = (wordId) => { if (!matched.has(wordId)) setSelected(wordId); };
  const finish = () => { if (complete && !busy) onRespond({ done: true }); };
  const digitKeys = {};
  pairs.slice(0, 9).forEach((_, row) => {
    digitKeys[String(row + 1)] = () => {
      if (complete) return;
      if (selected === null) pickLeft(pairs[row].wordId);
      else if (order[row] !== undefined) pickRight(pairs[order[row]].wordId);
    };
  });
  useCardLadderKeys({ ...digitKeys, ' ': finish, enter: finish });
  const hint = (row) => (row < 9 ? String(row + 1) : null);

  const state = (wordId, side) => {
    if (matched.has(wordId)) return 'is-matched';
    if (side === 'left' && selected === wordId) return 'is-selected';
    if (side === 'right' && wrong === wordId) return 'is-wrong';
    return '';
  };
  return (
    <section className="wl-item wl-match" aria-label="Match">
      <div className="wl-match__board">
        <div className="wl-match__column" role="group" aria-label="Words">
          {pairs.map((pair, row) => (
            <TouchButton
              key={pair.wordId}
              variant="choice"
              keyHint={hint(row)}
              lang={langs.term}
              className={state(pair.wordId, 'left')}
              aria-pressed={selected === pair.wordId}
              disabled={matched.has(pair.wordId)}
              onClick={() => pickLeft(pair.wordId)}
            >
              <FitText role="choice" text={pair.term} lang={langs.term} />
            </TouchButton>
          ))}
        </div>
        <div className="wl-match__column" role="group" aria-label="Meanings">
          {order.map((index, row) => {
            const pair = pairs[index];
            return (
              <TouchButton
                key={pair.wordId}
                variant="choice"
                keyHint={hint(row)}
                lang={langs.gloss}
                className={state(pair.wordId, 'right')}
                disabled={matched.has(pair.wordId)}
                onClick={() => pickRight(pair.wordId)}
              >
                <RightFace pair={pair} resolveAssetUrl={resolveAssetUrl} lang={langs.gloss} />
              </TouchButton>
            );
          })}
        </div>
      </div>
      <div className="wl-controls">
        {complete
          ? <TouchButton variant="primary" keyHint="Space" disabled={busy} onClick={finish}>Next</TouchButton>
          : <p className="wl-verdict" role="status">{selected ? 'Now tap its meaning' : 'Tap a word, then its meaning'}</p>}
      </div>
    </section>
  );
}
