// frontend/src/modules/Media/browse/HomeTile.jsx
// One item on the start page and in every card grid: the art first (shaped by
// the item's kind — stills 16:9, posters 2:3, music 1:1), a title that wraps to
// two lines, ONE muted meta line with the most useful fact, a thin progress
// bar on the art's bottom edge for unfinished items, and the ⋯ menu with every
// verb (in the title row, never over the art). The art and the title OPEN the
// item (a look); the small ▶ disc on the art's corner is the one deliberate
// play, and its accessible name says where it plays ("Play Sonic on Office
// Screen"). No Play bar, no slab: a disc on the thumbnail.
import React, { useState } from 'react';
import { Loader, UnstyledButton } from '@mantine/core';
import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconCast } from '@tabler/icons-react';
import { ItemMenu } from "../household/ItemMenu.jsx";
import { tileKind } from "./tilePresentation.js";
import { usePlayingOn } from "../fleet/usePlayingOn.js";
import { useStartingOn } from "../cast/useStartingOn.js";

// Plex serves an audiobook as an "album" with a book cover (taller than wide):
// a poster on a square tile would lose its title, so art that is clearly
// portrait switches an album tile to the poster shape once it has loaded.
const PORTRAIT_RATIO = 1.3;

export function HomeTile({
  item, title: titleOverride = null, meta = null, size = 'normal', onPicture, pictureLabel,
  onVerb, favourite, watched = null, removable = false, testId, progress = null,
  editions = null, onEdition = null, continueLabel = null, kind: kindOverride = null,
  onPlay = null, playLabel = null, playElsewhere = false,
}) {
  const title = titleOverride ?? item?.title ?? 'Untitled';
  const pictureName = pictureLabel ?? title;
  const spokenPictureName = Number.isFinite(progress) && progress > 0
    ? `${pictureName}, ${Math.round(progress)}% played`
    : pictureName;
  const [portraitThumbnail, setPortraitThumbnail] = useState(null);
  const [failedThumbnail, setFailedThumbnail] = useState(null);
  const hasPortraitArtwork = Boolean(item?.thumbnail) && portraitThumbnail === item.thumbnail;
  const thumbnailFailed = Boolean(item?.thumbnail) && failedThumbnail === item.thumbnail;
  let kind = kindOverride ?? tileKind(item);
  if (kind === 'square' && hasPortraitArtwork) kind = 'poster';
  // Addendum item 5: on a screen now → "On <screen>", the disc pauses (or
  // resumes) it there and the menu opens its controls — never a fresh ▶.
  // Addendum item 6: the disc alone spins while this item's start is in flight.
  const { playingOnFor, toggle, open } = usePlayingOn();
  const { isStarting } = useStartingOn();
  const on = item?.id ? playingOnFor(item.id) : null;
  const starting = !!item?.id && isStarting(item.id);
  const onLine = on ? `On ${on.name}` : null;
  const metaLines = (Array.isArray(meta) ? meta : [meta]).filter(Boolean)
    .filter((line) => !onLine || line !== `Now on ${on.name}`);
  const verb = (k) => (k === 'openScreen' && on ? open(on) : onVerb?.(k));
  const discLabel = on
    ? `${on.paused ? 'Resume' : 'Pause'} ${title} on ${on.name}`
    : (playLabel ?? `Play ${title}`);
  return (
    <div className={`home-tile home-tile--${size} home-tile--${kind}`} data-testid={testId} data-kind={kind}>
      <div className="home-tile-art">
        <UnstyledButton
          className="home-tile-picture"
          data-testid={`${testId}-picture`}
          aria-label={spokenPictureName}
          onClick={onPicture}
        >
          {item?.thumbnail && !thumbnailFailed
            ? (
              <img
                src={item.thumbnail}
                alt=""
                loading="lazy"
                onLoad={(event) => {
                  const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                  setPortraitThumbnail(w > 0 && h / w > PORTRAIT_RATIO ? item.thumbnail : null);
                }}
                onError={() => {
                  setFailedThumbnail(item.thumbnail);
                  setPortraitThumbnail(current => current === item.thumbnail ? null : current);
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
        {onPlay && (
          <UnstyledButton
            className={`home-tile-play${on ? ' home-tile-play--on' : ''}`}
            data-testid={`${testId}-play`}
            data-busy={starting || undefined}
            aria-busy={starting || undefined}
            disabled={starting}
            aria-label={discLabel}
            title={discLabel}
            onClick={(event) => { event.stopPropagation(); if (on) toggle(on, item.id); else onPlay(); }}
          >
            {starting
              ? <Loader size={16} color="gray" aria-hidden />
              : on
                ? (on.paused ? <IconPlayerPlayFilled size={16} aria-hidden /> : <IconPlayerPauseFilled size={16} aria-hidden />)
                : playElsewhere ? <IconCast size={18} aria-hidden /> : <IconPlayerPlayFilled size={16} aria-hidden />}
          </UnstyledButton>
        )}
      </div>
      <div className="home-tile-head">
        <div className="home-tile-body">
          {/* The title is a second way to the same action; the picture button is
              the keyboard/AT path, so this one stays out of the tab order. */}
          <span className="home-tile-title" title={title} onClick={onPicture} role="presentation">{title}</span>
          {onLine && <span className="home-tile-line home-tile-line--on" data-testid={`${testId}-on`}>{onLine}</span>}
          {metaLines.map((line, i) => (
            <span key={i} className="home-tile-line" data-testid={`${testId}-line-${i}`}>{line}</span>
          ))}
        </div>
        <div className="home-tile-more">
          <ItemMenu
            item={item}
            onVerb={verb}
            favourite={favourite}
            watched={watched}
            removable={removable}
            testId={testId}
            editions={editions}
            onEdition={onEdition}
            continueLabel={continueLabel}
            playingOn={on}
          />
        </div>
      </div>
    </div>
  );
}

export default HomeTile;
