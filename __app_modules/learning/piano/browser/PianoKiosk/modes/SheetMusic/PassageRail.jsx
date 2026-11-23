import { useLayoutEffect, useRef, useState } from 'react';
import { railFits, TILE_GAP_PX, TILE_MIN_PX } from './passageRail.js';
import PassageCoin, { PassageTurn } from './PassageCoin.jsx';
import './PassageRail.scss';

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
 * opens the board at that passage instead. `flips` names the tiles turning into
 * a coin right now; `flipDelayMs` holds the turn until the host's ceremony
 * announces it, and `wave` staggers it along a finished piece.
 */
export default function PassageRail({ model, flips = {}, flipDelayMs = 0, wave = false, boardOpen = false, onSelect, onPractice, onOpenBoard }) {
  const track = useRef(null);
  const width = useTrackWidth(track, Boolean(model?.tiles.length));
  if (!model?.tiles.length) return null;
  const fits = railFits(model.tiles.length, width);
  const columns = model.tiles.map((tile) => `minmax(${fits ? `${TILE_MIN_PX}px` : '0'}, ${tile.barCount}fr)`).join(' ');
  // A finished piece turns every tile in a wave that always lasts under a second.
  const stagger = wave ? Math.min(45, 900 / model.tiles.length) : 0;
  const before = (level) => (level === 'gold' ? 'silver' : 'learning');
  const bridges = model.bridges ?? [];
  return <nav className="piano-passage-rail" data-bare={onPractice ? undefined : true} aria-label="Passages in this piece" style={bridges.length ? { '--rail-h': `${model.railRem}rem` } : undefined}>
    {onPractice && <button type="button" className="piano-passage-rail__go" data-kind={model.target?.kind} disabled={!model.target} onClick={onPractice}>{model.buttonLabel}</button>}
    <div className="piano-passage-rail__map">
      <ol ref={track} className="piano-passage-rail__track" data-compact={!fits || undefined} style={{ gridTemplateColumns: columns, gap: fits ? TILE_GAP_PX : 2, maxWidth: `${model.tiles.length * 9}rem` }}>
        {model.tiles.map((tile, index) => <li key={tile.id}>
          <button type="button" className="piano-passage-rail__tile" data-state={tile.state} data-flip={flips[tile.id] || undefined}
            style={flips[tile.id] && (flipDelayMs || wave) ? { '--turn-delay': `${Math.round(flipDelayMs + index * stagger)}ms` } : undefined}
            aria-current={tile.id === model.outlinedId ? 'step' : undefined} aria-pressed={fits ? tile.id === model.selectedId : undefined}
            aria-label={fits ? tile.label : `${tile.label}. Open the passage board`}
            onClick={() => (fits ? onSelect?.(tile.id) : onOpenBoard?.(tile.id))}>
            {fits && <span className="piano-passage-rail__icon">{flips[tile.id] ? <PassageTurn from={before(flips[tile.id])} to={tile.state} /> : <PassageCoin state={tile.state} />}</span>}
            {fits && <span className="piano-passage-rail__bar">{tile.startLabel}</span>}
          </button>
        </li>)}
      </ol>
      {bridges.length > 0 && <ol className="piano-passage-rail__bridges" aria-label="Joins" style={{ gridTemplateColumns: columns, gap: `0 ${fits ? TILE_GAP_PX : 2}px`, maxWidth: `${model.tiles.length * 9}rem` }}>
        {bridges.map((bridge) => <li key={bridge.id} style={{ gridColumn: `${bridge.from + 1} / ${bridge.to + 2}`, gridRow: bridge.depth }}>
          <button type="button" className="piano-passage-rail__bridge" data-state={bridge.state} data-final={bridge.final || undefined}
            aria-current={bridge.id === model.outlinedId ? 'step' : undefined} aria-pressed={bridge.id === model.selectedId}
            aria-label={bridge.label} onClick={() => onSelect?.(bridge.id)}>
            {bridge.state === 'joined' ? <PassageCoin state="joined" size="1rem" /> : <i className="piano-passage-rail__ring" aria-hidden="true" />}
            <span>{bridge.final ? 'Whole piece' : 'Join'}</span>
          </button>
        </li>)}
      </ol>}
    </div>
    <button type="button" className="piano-passage-rail__count" data-level={model.count.level} aria-expanded={boardOpen}
      aria-label={`${model.count.label}. ${boardOpen ? 'Close' : 'Open'} the passage board`} onClick={() => onOpenBoard?.(null)}>
      <PassageCoin state={model.count.level} /><span>{model.count.text}</span><Chevron />
    </button>
  </nav>;
}
