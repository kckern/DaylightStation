// The header of a person, show, season, album or collection page (owner
// report 2026-11-27: "i dont see the artist/author image or bio"; jellyfin
// study rec 1–3, owner-approved 2026-11-27). Picture, name, the parent as a
// link, one muted facts line, the summary clamped with More (3 lines on the
// Mac, 2 on a phone, where it sits below the buttons), and the info view's own
// row of play controls (ItemActionRow) — never a row of long text buttons.
// Its words come from browseHeaderModel.js.
import React, { useEffect } from 'react';
import { Image, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ItemActionRow } from "./ItemActionRow.jsx";
import { ParentChip, ClampedSummary } from "./HeaderParts.jsx";
import { headerArt, headerFacts, headerKind, parentOf } from "./browseHeaderModel.js";
import mediaLog from "../logging/mediaLog.js";

// Browse keeps the ids its header had before (live specs drive them).
const BROWSE_TEST_IDS = Object.freeze({
  row: 'browse-dispatch-actions', play: 'browse-dispatch-play', playHere: 'browse-dispatch-play-here',
  playOn: 'browse-dispatch-play-on', more: 'browse-dispatch-more', moreMenu: 'browse-dispatch-more-menu',
  menu: { shuffle: 'browse-dispatch-shuffle', add: 'browse-dispatch-queue', fromStart: 'browse-dispatch-from-start' },
});

const ROUND_KINDS = new Set(['Author', 'Artist']);
const SQUARE_KINDS = new Set(['Album', 'Book', 'Collection', 'Playlist']);

export function BrowseHeader({
  item, contentId, itemCount = null, durationSeconds = null, unwatched = null, onOpenParent, onPrefetchParent = null, playRef = null,
}) {
  const phone = useMediaQuery('(max-width: 480px)') ?? false;
  const facts = headerFacts(item, { itemCount, durationSeconds, unwatched });
  const kind = headerKind(item);
  const art = headerArt(item);
  const parent = parentOf(item);
  const summary = item?.description || item?.metadata?.summary || null;
  useEffect(() => {
    if (!contentId) return;
    mediaLog.browseHeaderShown({ contentId, kind, hasArt: !!art, hasSummary: !!summary, hasParent: !!parent });
    // Once per page and kind: the facts settle as the list total arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, kind]);
  const shape = ROUND_KINDS.has(kind) ? ' browse-header__art--round' : SQUARE_KINDS.has(kind) ? ' browse-header__art--square' : '';
  const summaryBlock = summary
    ? <ClampedSummary key={phone ? 'phone' : 'mac'} text={summary} lines={phone ? 2 : 3} testId="browse-header-summary" contentId={contentId} />
    : null;
  const row = <ItemActionRow item={item} contentId={contentId} collection testIds={BROWSE_TEST_IDS} surface="browse" playRef={playRef} />;
  return (
    <header className="browse-header" data-testid="browse-dispatch-header" data-kind={kind ?? undefined}>
      {art && <Image src={art} alt="" className={`browse-header__art${shape}`} data-testid="browse-header-art" fit="cover" />}
      <div className="browse-header__top">
        <Title order={1} className="browse-header__title" data-testid="browse-header-title">{item?.title}</Title>
        {parent && (
          <ParentChip parent={parent} testId="browse-header-parent" onOpen={() => onOpenParent?.(parent)}
            onPrefetch={onPrefetchParent ? () => onPrefetchParent(parent) : null} />
        )}
        {facts.length > 0 && <Text size="sm" c="dimmed" data-testid="browse-header-facts">{facts.join(' · ')}</Text>}
      </div>
      <div className="browse-header__body">
        {phone ? <>{row}{summaryBlock}</> : <>{summaryBlock}{row}</>}
      </div>
    </header>
  );
}

export default BrowseHeader;
