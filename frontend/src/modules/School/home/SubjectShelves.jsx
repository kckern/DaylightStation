import { useState } from 'react';
import Icon from './icons/Icon.jsx';
import { planBands } from './shelfLayout.js';

/**
 * A subject's fold laid out by the shelf packer (shelfLayout.js) instead of a
 * blind stack of full-width rows. Each present kind is a shelf; the planner
 * bands them — a large collection gets a full-width, one-row band with "See
 * more" (flood mitigation), small kinds pack side-by-side sharing the width in
 * proportion to their counts. Aspect ratios are the tiles' own (video 2:3,
 * audio 1:1); this component only places the shelves and reveals overflow.
 *
 * `shelves` items: { kindId, verb, icon, token, Tile, items, onOpen }.
 */
function KindShelf({ shelf }) {
  const { kindId, verb, icon, token, Tile, items, onOpen, wide, cap } = shelf;
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? items : items.slice(0, cap);
  const hidden = items.length - visible.length;

  return (
    <section
      className={`school-shelf school-shelf--${kindId} ${wide ? 'is-wide' : 'is-narrow'} ${expanded ? 'is-expanded' : ''}`}
    >
      <header className="school-shelf__head">
        <span className="school-shelf__icon" style={{ color: `var(--kind-${token})` }}><Icon name={icon} /></span>
        <h2 className="school-shelf__verb">{verb}</h2>
        <span className="school-shelf__count">·{items.length}</span>
        {hidden > 0 && (
          <button type="button" className="school-shelf__more" onClick={() => setExpanded(true)}>
            See {hidden} more →
          </button>
        )}
        {expanded && items.length > cap && (
          <button type="button" className="school-shelf__more" onClick={() => setExpanded(false)}>Less</button>
        )}
      </header>
      <ul className="school-shelf__grid">
        {visible.map((item) => (
          <Tile key={`${item.id ?? item.label}`} item={item} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

// Narrow (non-flood) poster tiles grow to fill the band width so a sparse
// subject uses the space instead of leaving 3/4 empty: width = availWidth /
// poster-count, clamped so a lone item isn't absurd and a 2:3 poster never
// grows taller than the fold. Wide (flood) bands keep their compact tiles.
const AVAIL = 1200; // ~body inner width
const MIN_TILE = 180;
const MAX_TILE = 300; // 2:3 → 450px tall, fits the ~680px fold with margin
function bandTileWidth(band) {
  if (band.shelves.some((s) => s.wide)) return null;
  const posters = band.shelves
    .filter((s) => s.kindId === 'video' || s.kindId === 'audio')
    .reduce((n, s) => n + Math.min(s.items.length, s.cap), 0);
  if (posters === 0) return null;
  return Math.max(MIN_TILE, Math.min(MAX_TILE, Math.floor(AVAIL / posters)));
}

export default function SubjectShelves({ shelves }) {
  const present = shelves.filter((s) => s.items.length > 0);
  const bands = planBands(present);
  return (
    <div className="school-shelves">
      {bands.map((band, i) => {
        const w = bandTileWidth(band);
        return (
          // eslint-disable-next-line react/no-array-index-key
          <div className="school-shelf-band" key={i} style={w ? { '--tile-w': `${w}px` } : undefined}>
            {band.shelves.map((s) => <KindShelf key={s.kindId} shelf={s} />)}
          </div>
        );
      })}
    </div>
  );
}
