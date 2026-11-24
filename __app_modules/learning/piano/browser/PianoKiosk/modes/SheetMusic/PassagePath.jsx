import { useLayoutEffect, useRef, useState } from 'react';
import { LINK_PX, NEXT_BUMP_PX, pathLayout } from './passageRail.js';
import PassageCoin, { PassageTurn } from './PassageCoin.jsx';
import CoinIcon from '../../../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import GemIcon from '../../../../../../../frontend/src/lib/icons/GemIcon.jsx';
import Icon from '../../../ui/icons/Icon.jsx';
import { POLISH_DIAMOND_COLOR } from './polishAwards.js';
import './PassagePath.scss';

/** The path's width, measured before paint so a long piece never flashes full-size tokens. */
function useTrackWidth(ref, mounted) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!mounted || !node) return undefined;
    const measure = () => setWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

const Play = () => <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><path d="M5.5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L6.4 3.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>;
/** A goal not reached yet: the outline of its coin or stone. */
const Outline = ({ level }) => (level === 'diamond'
  ? <svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><path d="M18 31 4.5 14.5 10 6.5h16l5.5 8z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
  : <svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><circle cx="18" cy="18" r="14.5" fill="none" stroke="currentColor" strokeWidth="3" /></svg>);
const Mark = ({ mark }) => (!mark.reached ? <Outline level={mark.level} />
  : mark.level === 'diamond' ? <GemIcon size="100%" color={POLISH_DIAMOND_COLOR} /> : <CoinIcon metal={mark.level} size="100%" />);

// What a token was the moment before it turned: a passage's flower or its Bronze, a join's socket.
const before = (token, level) => (level === 'gold' ? (token.kind === 'passage' ? 'silver' : 'joined') : token.kind === 'passage' ? 'learning' : 'socket');

/**
 * The Learn path under the score and under the drill: the piece's passages as lettered tokens read
 * left to right (A, B, C…), the next join as a socket between its halves, earned joins as one coin.
 * The coach's next unit is drawn larger. The play disc sits on the target; tapping the target or the
 * next opens it (`onOpen(id)`), tapping any other token selects it (`onSelect(id)`). The caption at
 * the left names the task; the right end is the goal (three marks) and the All button that opens the
 * board. When a long piece cannot give every token a 44px target the path is a lettered strip, and a
 * tap opens the board at that unit. `flips` names the units turning into a coin right now;
 * `flipDelayMs` holds the turn until the host's ceremony announces it, and `wave` staggers it along
 * a finished piece.
 */
export default function PassagePath({ model, flips = {}, flipDelayMs = 0, wave = false, boardOpen = false, onSelect, onOpen, onOpenBoard }) {
  const track = useRef(null);
  const tokens = model?.tokens ?? [];
  const width = useTrackWidth(track, tokens.length > 0);
  if (!tokens.length) return null;
  const { size, compact } = pathLayout(tokens.length, width);
  // A finished piece turns every token in a wave that always lasts under a second.
  const stagger = wave ? Math.min(45, 900 / tokens.length) : 0;
  const flipOf = (token) => flips[token.id] || null;
  const tap = (token) => {
    if (compact) onOpenBoard?.(token.id);
    else if (token.isTarget || token.isNext) onOpen?.(token.id);
    else onSelect?.(token.id);
  };
  return <nav className="piano-passage-path" aria-label="Passages in this piece" data-lap={model.lap}
    style={{ '--token': `${size}px`, '--token-next': `${size + NEXT_BUMP_PX}px`, '--link': `${LINK_PX}px`, '--path-h': `${model.railRem}rem` }}>
    <p className="piano-passage-path__caption" aria-live="polite">{String(model.caption ?? '').split(' ').flatMap((word, index) => [index ? ' ' : null, word.includes('–') ? <span key={index}>{word}</span> : word])}</p>
    <ol ref={track} className="piano-passage-path__track" data-compact={compact || undefined}>
      {tokens.map((token, index) => {
        const flip = flipOf(token);
        return <li key={token.id} data-link={token.link} data-kind={token.kind}>
          <button type="button" className="piano-passage-path__token" data-state={token.state} data-kind={token.kind} data-flip={flip || undefined}
            data-next={token.isNext || undefined} data-target={token.isTarget || undefined}
            style={flip && (flipDelayMs || wave) ? { '--turn-delay': `${Math.round(flipDelayMs + index * stagger)}ms` } : undefined}
            aria-current={token.isTarget ? 'step' : undefined} aria-pressed={compact ? undefined : token.isSelected}
            aria-label={compact ? `${token.label}. Open the passage board` : token.aria} onClick={() => tap(token)}>
            {compact ? <span className="piano-passage-path__pill">{token.letter}</span> : <>
              <span className="piano-passage-path__disc">
                {flip ? <PassageTurn from={before(token, flip)} to={token.state} letter={token.letter} ring={token.ring} size="100%" />
                  : <PassageCoin state={token.state} letter={token.letter} ring={token.ring} size="100%" />}
                {token.isTarget && <i className="piano-passage-path__play" aria-hidden="true"><Play /></i>}
              </span>
              <span className="piano-passage-path__bars" aria-hidden="true">{token.isTarget || token.isNext ? lowerBars(token.bars) : ''}</span>
            </>}
          </button>
        </li>;
      })}
    </ol>
    <ul className="piano-passage-path__marks" aria-label="Goals for this piece">
      {model.marks.map((mark) => <li key={mark.level} data-level={mark.level} data-reached={mark.reached}
        aria-label={`${mark.label}: ${mark.reached ? 'done' : 'not yet'}`}><Mark mark={mark} /></li>)}
    </ul>
    <button type="button" className="piano-passage-path__all" aria-expanded={boardOpen} aria-label={`All passages, ${model.count.label}`}
      onClick={() => onOpenBoard?.(null)}>
      <Icon name="grid" /><span>All</span>
    </button>
  </nav>;
}

function lowerBars(label) { return label.charAt(0).toLowerCase() + label.slice(1); }
