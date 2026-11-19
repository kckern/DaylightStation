import { useLayoutEffect, useRef, useState } from 'react';
import { railFits, TILE_GAP_PX, TILE_MIN_PX } from './passageRail.js';
import PassageCoin, { PassageTurn } from './PassageCoin.jsx';
import './PassageRail.scss';

const PIECE_COPY = Object.freeze({
  silver: { title: 'Your whole piece is Silver!', detail: 'You can play every passage on your own. Now go round again for Gold.' },
  gold: { title: 'Your whole piece is Gold!', detail: 'You played every passage with the beat.' },
});

const Chevron = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 10.5 8 5.5l5 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** The track's width, measured before paint so a long piece never flashes full-size tiles. */
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

/**
 * The slim rail under the score: the one practice button, every passage of the
 * piece as a tile (widths follow bar counts, never scrolls), and the count that
 * opens the board. A passage is drawn as its state: a tomato, a flower, a silver
 * coin or a gold coin. Tapping a tile only selects it. A host with no practice
 * button of its own (the drill screen) leaves `onPractice` out. When a long piece cannot give
 * every tile a usable touch target the tiles become a plain map, and a tap on it
 * opens the board at that passage instead.
 */
export default function PassageRail({ model, flips = {}, piece = null, boardOpen = false, onSelect, onPractice, onOpenBoard, onDismissPiece }) {
  const track = useRef(null);
  const width = useTrackWidth(track, Boolean(model?.tiles.length));
  if (!model?.tiles.length) return null;
  const fits = railFits(model.tiles.length, width);
  const columns = model.tiles.map((tile) => `minmax(${fits ? `${TILE_MIN_PX}px` : '0'}, ${tile.barCount}fr)`).join(' ');
  const cheer = piece ? PIECE_COPY[piece] : null;
  const before = (level) => (level === 'gold' ? 'silver' : 'learning');
  return <nav className="piano-passage-rail" data-bare={onPractice ? undefined : true} aria-label="Passages in this piece">
    {cheer && <button type="button" className="piano-passage-rail__cheer" data-level={piece} onClick={onDismissPiece}>
      <strong role="status">{cheer.title}</strong><span>{cheer.detail}</span>
    </button>}
    {onPractice && <button type="button" className="piano-passage-rail__go" data-kind={model.target?.kind} disabled={!model.target} onClick={onPractice}>{model.buttonLabel}</button>}
    <ol ref={track} className="piano-passage-rail__track" data-compact={!fits || undefined} style={{ gridTemplateColumns: columns, gap: fits ? TILE_GAP_PX : 2, maxWidth: `${model.tiles.length * 9}rem` }}>
      {model.tiles.map((tile, index) => <li key={tile.id}>
        <button type="button" className="piano-passage-rail__tile" data-state={tile.state} data-flip={flips[tile.id] || undefined}
          style={flips[tile.id] && piece ? { '--turn-delay': `${index * 45}ms` } : undefined}
          aria-current={tile.id === model.outlinedId ? 'step' : undefined} aria-pressed={fits ? tile.id === model.selectedId : undefined}
          aria-label={fits ? tile.label : `${tile.label}. Open the passage board`}
          onClick={() => (fits ? onSelect?.(tile.id) : onOpenBoard?.(tile.id))}>
          {fits && <span className="piano-passage-rail__icon">{flips[tile.id] ? <PassageTurn from={before(flips[tile.id])} to={tile.state} /> : <PassageCoin state={tile.state} />}</span>}
          {fits && <span className="piano-passage-rail__bar">{tile.startLabel}</span>}
        </button>
      </li>)}
    </ol>
    <button type="button" className="piano-passage-rail__count" data-level={model.count.level} aria-expanded={boardOpen}
      aria-label={`${model.count.label}. ${boardOpen ? 'Close' : 'Open'} the passage board`} onClick={() => onOpenBoard?.(null)}>
      <PassageCoin state={model.count.level} /><span>{model.count.text}</span><Chevron />
    </button>
  </nav>;
}
