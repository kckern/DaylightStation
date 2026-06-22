import React from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import CropEditor from './CropEditor.jsx';

// 3x3 numpad compass overlay; highlights the work's current crop anchor.
const COMPASS = [
  ['top left', 'top', 'top right'],
  ['left', 'center', 'right'],
  ['bottom left', 'bottom', 'bottom right'],
];
const anchorOrCenter = (a) => (a == null ? 'center' : a);

export default function Loupe({ work, total, index, saved, onAnchor, onCrop }) {
  if (!work) return <div className="art-loupe art-loupe--empty">No artwork</div>;
  const m = work.meta || {};
  const active = anchorOrCenter(m.crop_anchor);
  return (
    <div className="art-loupe">
      <div className="art-loupe__stage">
        {/* key forces a fresh <img> on navigation so the previous artwork
            unmounts instead of lingering while the new src decodes. */}
        <img key={work.id} className="art-loupe__img"
          src={DaylightMediaPath(work.image)} alt={m.title || 'Artwork'} />
        {onCrop
          ? <CropEditor crop={m.crop} onCrop={onCrop} />
          : (
            /* Clickable crop-anchor compass: click the region of the image to keep.
               Works without a numpad (numpad keys still set the same anchors). */
            <div className="art-loupe__compass" role="group" aria-label="Set crop anchor">
              {COMPASS.flat().map((pos) => (
                <button
                  type="button"
                  key={pos}
                  className={`art-loupe__cell${pos === active ? ' is-active' : ''}`}
                  title={`Anchor: ${pos}`}
                  onClick={() => onAnchor?.(pos)}
                >
                  <span className="art-loupe__cell-dot" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        <div className="art-loupe__counter">{index + 1} / {total}{saved ? ' · ✓ saved' : ''}</div>
      </div>
      <aside className="art-loupe__meta">
        <h3 className="art-loupe__title">{m.title || '(untitled)'}</h3>
        <div className="art-loupe__sub">{[m.artist, m.date].filter(Boolean).join(' · ')}</div>
        <div className="art-loupe__tags">
          {(m.tags || []).map((t) => <span key={t} className="art-tag">{t}</span>)}
        </div>
        <div className="art-loupe__state">
          {m.hidden ? <span className="art-pill art-pill--hidden">hidden</span> : null}
          {m.flagged ? <span className="art-pill art-pill--flagged">flagged</span> : null}
          <span className="art-pill">{m.crop?.enabled === false ? 'no-crop' : (Number.isFinite(m.crop?.top) ? `crop ${m.crop.top}/${m.crop.bottom}` : `anchor: ${active}`)}</span>
        </div>
      </aside>
    </div>
  );
}
