// One item's row of play controls: the info view's row 1 (owner ruling
// 2026-11-26), shared with the Browse header (2026-11-27) so a container page
// and an info page offer the same four controls with the same labels.
import React, { useState } from 'react';
import { Text, Button, Group, Menu } from '@mantine/core';
import { IconPlayerSkipBack, IconPlayerPlayFilled, IconPlayerTrackNext, IconRowInsertTop, IconPlaylistAdd, IconCast, IconRotate, IconDots, IconArrowsShuffle, IconPlaylist, IconPhoto, IconAdjustments, IconHeart, IconHeartFilled, IconEye, IconEyeOff } from '@tabler/icons-react';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { useContentDispatch } from "../search/useContentDispatch.js";
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { useItemVerbs } from "../household/useItemVerbs.jsx";
import { useFavourites } from "../household/useHousehold.js";
import { itemMenuEntries, menuItemKind, MENU_LABELS, resumeLabel } from "../actions/itemMenuTable.js";
import { resumePlan } from "../household/householdModel.js";
import { useCollectionContinue } from "../household/collectionContinue.js";
import { usePlaybackQuality } from "../quality/PlaybackQualityProvider.jsx";
import { supportsQualityOverrides } from "../quality/PlaybackQualityButtons.jsx";
import { useStartingOn } from "../cast/useStartingOn.js";
import { usePressHoldOffer } from "../../../../../frontend/src/lib/ui/usePressHoldOffer.js";
import mediaLog from "../logging/mediaLog.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { usePlayingOn } from "../fleet/usePlayingOn.js";
import { usePhoneKeeps } from "../cast/usePhoneKeeps.jsx";

// More ⋯ entries keep the test ids their buttons had before the owner's
// 2026-11-26 ruling moved them here.
const MORE_TEST_ID = {
  fromStart: 'detail-from-start', shuffle: 'detail-shuffle', playNext: 'detail-play-next', playFirst: 'detail-up-next', add: 'detail-add',
  addOn: 'detail-add-on', showBrieflyOn: 'detail-show-briefly', quality: 'detail-quality',
  favourite: 'detail-favourite', unfavourite: 'detail-favourite', watched: 'detail-watched', unwatched: 'detail-unwatched',
};
const MORE_ICON = {
  fromStart: IconPlayerSkipBack, shuffle: IconArrowsShuffle, playNext: IconPlayerTrackNext, playFirst: IconRowInsertTop, add: IconPlaylistAdd,
  addOn: IconPlaylist, showBrieflyOn: IconPhoto, quality: IconAdjustments,
  favourite: IconHeart, unfavourite: IconHeartFilled, watched: IconEye, unwatched: IconEyeOff,
};

// "720p" / "Custom" beside Quality… when this item has an override.
function qualitySummary(quality, item) {
  if (!quality || !supportsQualityOverrides(item)) return null;
  const overrides = quality.getOverrides(item.contentId ?? item.id);
  if (overrides.maxResolution) return `${overrides.maxResolution}p`;
  return Object.keys(overrides).length ? 'Custom' : null;
}

// The info view's More ⋯: every verb that is not row 1, grouped by the table's
// dividers. Esc closes it and leaves focus on More (ActionMenu), never the page.
function DetailMoreMenu({ contentId, entries, qualitySummary: summary, playNextHold, onPick, testIds }) {
  const menuIds = testIds.menu;
  const pick = (kind) => () => {
    mediaLog.detailMorePicked({ contentId, verb: kind });
    onPick(kind);
  };
  return (
    <ActionMenu
      withinPortal
      position="bottom-end"
      shadow="sm"
      onOpen={() => mediaLog.detailMoreOpened({ contentId, entries: entries.filter((e) => !e.divider).length })}
      dropdownProps={{ 'data-testid': testIds.moreMenu }}
      trigger={(
        <Button variant="default" data-testid={testIds.more} rightSection={<IconDots size={16} />}>
          {MENU_LABELS.more}
        </Button>
      )}
    >
      {entries.map((entry, index) => {
        if (entry.divider) return <Menu.Divider key={`divider-${index}`} />;
        const Icon = MORE_ICON[entry.kind];
        const leftSection = Icon ? <Icon size={16} /> : null;
        if (entry.kind === 'playNext') {
          return (
            <React.Fragment key="playNext">
              <Menu.Item data-testid={menuIds.playNext} leftSection={leftSection}
                closeMenuOnClick={!playNextHold.offered} {...playNextHold.bind}
                onClick={playNextHold.guardClick(pick('playNext'))}>
                {entry.label}
              </Menu.Item>
              {playNextHold.offered && (
                <Menu.Item data-testid="detail-play-next-front" leftSection={<IconRowInsertTop size={16} />}
                  onClick={() => { playNextHold.dismiss(); pick('playNextFront')(); }}>
                  {MENU_LABELS.playNextFront}
                </Menu.Item>
              )}
            </React.Fragment>
          );
        }
        return (
          <Menu.Item key={entry.kind}
            data-testid={menuIds[entry.kind] ?? (/^keepOn:/.test(entry.kind) ? 'detail-keep-on' : /^unkeepOn:/.test(entry.kind) ? 'detail-unkeep-on' : /^cancelKeepOn:/.test(entry.kind) ? 'detail-cancel-keep' : undefined)}
            leftSection={leftSection}
            rightSection={entry.kind === 'quality' && summary ? <Text size="xs" c="dimmed">{summary}</Text> : null}
            onClick={pick(entry.kind)}>
            {entry.label}
          </Menu.Item>
        );
      })}
    </ActionMenu>
  );
}


const DEFAULT_TEST_IDS = Object.freeze({
  row: 'detail-row-one', play: 'detail-play-now', playHere: 'detail-play-here', playOn: 'detail-play-on',
  more: 'detail-more', moreMenu: 'detail-more-menu', menu: MORE_TEST_ID,
});

/**
 * Row 1 of the info view (owner ruling 2026-11-26), shared with the Browse
 * header so both pages offer the same four controls: the amber
 * "▶ Play on <dest>" (Start over on <screen> when the item is already there),
 * Play here, Play on…, and More ⋯ from the one menu table.
 *
 * `testIds` renames the controls for another page (Browse keeps its
 * `browse-dispatch-*` ids); `stopPreview` runs before any verb that sends the
 * item anywhere; `entry`/`pendingResume` are the household entry for a leaf.
 */
export function ItemActionRow({
  item, contentId, collection = false, entry = null, pendingResume = false,
  playRef = null, stopPreview = () => {}, testIds = DEFAULT_TEST_IDS, surface = 'detail',
}) {
  const [oneShot, setOneShot] = useState(null);
  const { dispatchLeafVerb, playContainerAsQueue, addContainerToQueue } = useContentDispatch();
  // A collection plays as a whole, replacing the queue (Browse's ▶ before
  // 2026-11-27 did the same); a leaf plays through the household verbs.
  const playWhole = (shuffle = false) => {
    if (!playContainerAsQueue) return dispatchLeafVerb(shuffle ? 'shuffle' : 'playNow', contentId, item);
    return shuffle ? playContainerAsQueue(contentId, item, { shuffle: true }) : playContainerAsQueue(contentId, item);
  };
  const { run, overlays } = useItemVerbs();
  const phoneKeeps = usePhoneKeeps();
  const { destinationFor, labelsFor } = usePlayDestination();
  const favourites = useFavourites();
  const quality = usePlaybackQuality();
  const { isStarting } = useStartingOn();
  const starting = isStarting(contentId);
  const { playingOnFor, startOver: startOverOn } = usePlayingOn();
  const on = playingOnFor(contentId);
  const playNextHold = usePressHoldOffer({ onOffered: () => mediaLog.playNextHoldOffered({ surface }) });
  const ids = { ...DEFAULT_TEST_IDS, ...testIds, menu: { ...MORE_TEST_ID, ...(testIds.menu ?? {}) } };
  const where = destinationFor(item);
  const elsewhere = where.targetIds.length > 0;
  const whereName = elsewhere ? labelsFor(item).short : null;
  const keep = phoneKeeps.forItem(item);
  const favourite = favourites.has(contentId);
  // PLAY names the resume point (owner-approved 2026-11-27): a leaf with a
  // saved spot reads "Resume on X · 42:10"; a show under way reads
  // "Continue S3E7 on X". From the start moves to More.
  const { continueFor } = useCollectionContinue();
  const cont = collection && !on ? continueFor(item) : null;
  const plan = !collection && !on ? resumePlan(entry) : { kind: 'start' };
  const resumeAt = plan.kind === 'continue' ? plan.spot.playhead : null;
  const resumable = !!cont || plan.kind !== 'start';
  const sentence = labelsFor(item).sentence;
  const playLabel = on ? `Start over on ${on.name}`
    : cont ? `${cont.label}${elsewhere ? ` on ${whereName}` : where.source === 'ask' ? ' on…' : ' here'}`
      : resumable ? resumeLabel(sentence, resumeAt) : sentence;
  const playContinue = () => {
    const episode = { id: cont.contentId, title: cont.title, type: 'episode', itemType: 'leaf' };
    mediaLog.collectionContinued({ collectionId: contentId, contentId: cont.contentId, label: cont.label });
    if (dispatchLeafVerb('playNow', cont.contentId, episode) === 'ask') setOneShot({ kind: 'playOn', item: episode });
  };
  return (
    <>
      <Group className="detail-actions detail-row-one" gap="sm" data-testid={ids.row}>
        <Button
          data-testid={ids.play}
          className="detail-play-primary"
          ref={playRef}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
          leftSection={on ? <IconRotate size={18} /> : elsewhere ? <IconCast size={18} /> : <IconPlayerPlayFilled size={18} />}
          loading={(!collection && pendingResume) || starting}
          data-busy={starting || undefined}
          onClick={() => {
            stopPreview();
            if (on) { startOverOn(on, contentId); return; }
            if (cont) { playContinue(); return; }
            const route = collection ? playWhole() : run('playNow', item, { entry });
            if (route === 'ask') setOneShot({ kind: 'playOn', item });
          }}
        >
          {playLabel}
        </Button>
        {/* Play here whenever ▶ goes to a screen: the aim's, or the one the
            item is already on (where PLAY is Start over). */}
        {(elsewhere || on) && (
          <Button
            data-testid={ids.playHere}
            variant="default"
            onClick={() => { stopPreview(); dispatchLeafVerb('playNow', contentId, item, { targetIds: [] }); }}
          >
            {MENU_LABELS.playHere}
          </Button>
        )}
        {/* When ▶ itself asks where ("Play on…"), a second Play on… says the same thing twice. */}
        {!(where.source === 'ask' && !on) && (
          <Button variant="default" data-testid={ids.playOn} onClick={() => { stopPreview(); setOneShot({ kind: 'playOn', item }); }}>{MENU_LABELS.playOn}</Button>
        )}
        <DetailMoreMenu
          contentId={contentId}
          testIds={ids}
          entries={itemMenuEntries({
            surface: 'detail',
            kind: menuItemKind({ collection }),
            where: { elsewhere, short: whereName },
            favourite,
            quality: !!quality && supportsQualityOverrides(item),
            keep: keep.entries,
            resumable,
          })}
          qualitySummary={qualitySummary(quality, item)}
          playNextHold={playNextHold}
          onPick={(kind) => {
            if (kind === 'quality') { quality.openForItem(item); return; }
            if (phoneKeeps.run(kind, item)) return;
            if (kind === 'favourite' || kind === 'unfavourite' || kind === 'watched' || kind === 'unwatched') { run(kind, item); return; }
            stopPreview();
            if (kind === 'addOn' || kind === 'showBrieflyOn') { setOneShot({ kind, item }); return; }
            if (kind === 'fromStart') {
              mediaLog.playFromStart({ contentId, surface });
              const route = collection ? playWhole() : dispatchLeafVerb('playNow', contentId, item, { startAt: 0 });
              if (route === 'ask') setOneShot({ kind: 'playOn', item });
              return;
            }
            if (kind === 'playNextFront') { mediaLog.playNextFrontChosen({ surface }); dispatchLeafVerb('playFirst', contentId, item); return; }
            if (collection && kind === 'shuffle') { if (playWhole(true) === 'ask') setOneShot({ kind: 'playOn', item }); return; }
            if (collection && kind === 'add' && addContainerToQueue) { addContainerToQueue(contentId, item); return; }
            if (dispatchLeafVerb(kind, contentId, item) === 'ask') setOneShot({ kind: 'playOn', item });
          }}
        />
      </Group>
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
      {overlays}
    </>
  );
}

export default ItemActionRow;
