// frontend/src/modules/Media/browse/HomeTile.jsx
// One item on the start page and in every card grid: the art first (shaped by
// the item's kind — stills 16:9, posters 2:3, music 1:1), a title that wraps to
// two lines, ONE muted meta line with the most useful fact, a thin progress
// bar on the art's bottom edge for unfinished items, and the ⋯ menu with every
// verb (in the title row, never over the art). The art and the title both follow the tap rule they are given; there
// is no per-tile Play bar.
import React, { useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { ItemMenu } from '../household/ItemMenu.jsx';
import { tileKind } from './tilePresentation.js';

// Plex serves an audiobook as an "album" with a book cover (taller than wide):
// a poster on a square tile would lose its title, so art that is clearly
// portrait switches an album tile to the poster shape once it has loaded.
const PORTRAIT_RATIO = 1.3;

export function HomeTile({
  item, title: titleOverride = null, meta = null, size = 'normal', onPicture, pictureLabel,
  onVerb, favourite, watched = null, removable = false, testId, progress = null,
  editions = null, onEdition = null, continueLabel = null, kind: kindOverride = null,
}) {
  const title = titleOverride ?? item?.title ?? 'Untitled';
  const [portrait, setPortrait] = useState(false);
  let kind = kindOverride ?? tileKind(item);
  if (kind === 'square' && portrait) kind = 'poster';
  return (
    <div className={`home-tile home-tile--${size} home-tile--${kind}`} data-testid={testId} data-kind={kind}>
      <div className="home-tile-art">
        <UnstyledButton
          className="home-tile-picture"
          data-testid={`${testId}-picture`}
          aria-label={pictureLabel ?? title}
          onClick={onPicture}
        >
          {item?.thumbnail
            ? (
              <img
                src={item.thumbnail}
                alt=""
                loading="lazy"
                onLoad={(event) => {
                  const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                  if (w > 0 && h / w > PORTRAIT_RATIO) setPortrait(true);
                }}
              />
            )
            : <span className="home-tile-placeholder" aria-hidden>{title.slice(0, 1).toUpperCase()}</span>}
          {Number.isFinite(progress) && progress > 0 && (
            <span className="home-tile-progress" aria-hidden>
              <span className="home-tile-progress-fill" style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
            </span>
          )}
        </UnstyledButton>
      </div>
      <div className="home-tile-head">
        <div className="home-tile-body">
          {/* The title is a second way to the same action; the picture button is
              the keyboard/AT path, so this one stays out of the tab order. */}
          <span className="home-tile-title" title={title} onClick={onPicture} role="presentation">{title}</span>
          {(Array.isArray(meta) ? meta : [meta]).filter(Boolean).map((line, i) => (
            <span key={i} className="home-tile-line" data-testid={`${testId}-line-${i}`}>{line}</span>
          ))}
        </div>
        <div className="home-tile-more">
          <ItemMenu
            item={item}
            onVerb={onVerb}
            favourite={favourite}
            watched={watched}
            removable={removable}
            testId={testId}
            editions={editions}
            onEdition={onEdition}
            continueLabel={continueLabel}
          />
        </div>
      </div>
    </div>
  );
}

export default HomeTile;
