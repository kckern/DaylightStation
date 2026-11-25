import { useLayoutEffect, useRef, useState } from 'react';
import { LINK_PX, NEXT_BUMP_PX, RAIL_LINK_PX, pathLayout, railLayout } from './passageRail.js';
import PassageCoin, { PassageTurn } from './PassageCoin.jsx';
import LevelLadder from './LevelLadder.jsx';
import usePassageTomatoes from './usePassageTomatoes.js';
import Icon from '../../../ui/icons/Icon.jsx';
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
// What a token was the moment before it turned: a passage's flower or its Bronze, a join's socket.
const before = (token, level) => (level === 'gold' ? (token.kind === 'passage' ? 'silver' : 'joined') : token.kind === 'passage' ? 'learning' : 'socket');

/**
 * The Learn path under the score and under the drill: the piece's passages as lettered tokens read
 * left to right (A, B, C…), the next join as a socket between its halves, earned joins as one coin.
 * The coach's next unit is drawn larger. The play disc sits on the target; tapping the target or the
 * next opens it (`onOpen(id)`), tapping any other token selects it (`onSelect(id)`). The caption at
 * the left names the task; the right end is the level ladder (Bronze → Silver → Gold → Diamond) and the All button that opens the
 * board. When a long piece cannot give every token a 44px target the path is a lettered strip, and a
 * tap opens the board at that unit. `flips` names the units turning into a coin right now;
 * `flipDelayMs` holds the turn until the host's ceremony announces it, and `wave` staggers it along
 * a finished piece. A passage not yet started wears a tomato for a learner (`tomatoes`, else
 * `sheetmusic.learn.tomatoes` for whoever is playing).
 *
 * `variant="rail"` is the drill's coach rail (2026-11-24, two rails): the coins only, at about 44px, the
 * unit being drilled ringed. No caption, no bars under a coin, no play disc, no ladder and no All button:
 * the status line names the task and its bars, and the rail's right end is the ladder.
 */
export default function PassagePath({ model, variant = 'path', flips = {}, flipDelayMs = 0, wave = false, boardOpen = false, tomatoes: tomatoesProp, onSelect, onOpen, onOpenBoard }) {
  const track = useRef(null);
  const tomatoesFor = usePassageTomatoes();
  const tomatoes = tomatoesProp ?? tomatoesFor;
  const tokens = model?.tokens ?? [];
  const width = useTrackWidth(track, tokens.length > 0);
  if (!tokens.length) return null;
  const onRail = variant === 'rail';
  const { size, compact } = onRail ? railLayout(tokens.length, width) : pathLayout(tokens.length, width);
  // A finished piece turns every token in a wave that always lasts under a second.
  const stagger = wave ? Math.min(45, 900 / tokens.length) : 0;
  const flipOf = (token) => flips[token.id] || null;
  const tap = (token) => {
    if (compact) onOpenBoard?.(token.id);
    else if (token.isTarget || token.isNext) onOpen?.(token.id);
    else onSelect?.(token.id);
  };
  return <nav className={`piano-passage-path${onRail ? ' piano-passage-path--rail' : ''}`} aria-label="Passages in this piece" data-lap={model.lap}
    style={onRail ? { '--token': `${size}px`, '--token-next': `${size}px`, '--link': `${RAIL_LINK_PX}px` }
      : { '--token': `${size}px`, '--token-next': `${size + NEXT_BUMP_PX}px`, '--link': `${LINK_PX}px`, '--path-h': `${model.railRem}rem` }}>
    {!onRail && <p className="piano-passage-path__caption" aria-live="polite">{String(model.caption ?? '').split(' ').flatMap((word, index) => [index ? ' ' : null, word.includes('–') ? <span key={index}>{word}</span> : word])}</p>}
    <ol ref={track} className="piano-passage-path__track" data-compact={compact || undefined}>
      {tokens.map((token, index) => {
        const flip = flipOf(token);
        return <li key={token.id} data-link={token.link} data-kind={token.kind}>
          <button type="button" className="piano-passage-path__token" data-state={token.state} data-kind={token.kind} data-flip={flip || undefined}
            data-next={(!onRail && token.isNext) || undefined} data-target={token.isTarget || undefined} data-step-down={token.isStepDown || undefined}
            style={flip && (flipDelayMs || wave) ? { '--turn-delay': `${Math.round(flipDelayMs + index * stagger)}ms` } : undefined}
            aria-current={token.isTarget ? 'step' : undefined} aria-pressed={compact ? undefined : token.isSelected}
            aria-label={compact ? `${token.label}. Open the passage board` : token.aria} onClick={() => tap(token)}>
            {compact ? <span className="piano-passage-path__pill">{token.letter}</span> : <>
              <span className="piano-passage-path__disc">
                {flip ? <PassageTurn from={before(token, flip)} to={token.state} letter={token.letter} ring={token.ring} tomato={tomatoes} size="100%" />
                  : <PassageCoin state={token.state} letter={token.letter} ring={token.ring} tomato={tomatoes} size="100%" />}
                {token.isTarget && !onRail && <i className="piano-passage-path__play" aria-hidden="true"><Play /></i>}
              </span>
              {!onRail && <span className="piano-passage-path__bars" aria-hidden="true">{token.isTarget || token.isNext ? lowerBars(token.bars) : ''}</span>}
            </>}
          </button>
        </li>;
      })}
    </ol>
    {!onRail && <LevelLadder ladder={model.ladder} className="piano-passage-path__ladder" />}
    {!onRail && <button type="button" className="piano-passage-path__all" aria-expanded={boardOpen} aria-label={`All passages, ${model.count.label}`}
      onClick={() => onOpenBoard?.(null)}>
      <Icon name="grid" /><span>All</span>
    </button>}
  </nav>;
}

function lowerBars(label) { return label.charAt(0).toLowerCase() + label.slice(1); }
