import React from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';

export default function GridView({ works, index, onPick }) {
  return (
    <div className="art-grid" role="listbox" aria-label="Art works">
      {works.map((w, i) => {
        const m = w.meta || {};
        return (
          <button
            key={w.id}
            type="button"
            className={`art-grid__cell${i === index ? ' is-focused' : ''}${m.hidden ? ' is-hidden' : ''}`}
            onClick={() => onPick(i)}
            aria-selected={i === index}
          >
            <img src={DaylightMediaPath(w.image)} alt={m.title || 'Artwork'} loading="lazy" />
            {m.flagged ? <span className="art-grid__flag">⚑</span> : null}
            {(m.tags || []).length ? <span className="art-grid__tagdot" /> : null}
          </button>
        );
      })}
    </div>
  );
}
