// frontend/src/modules/Media/shell/PlayerFeatureControls.jsx
// Player features in the one set of controls (P2), for this device and for
// any screen through its Remote — the same component, bound to either side:
//
//   - Subtitles / Audio (RQ-STEER-14): only the tracks the item has.
//   - Add music behind (RQ-PLAY-12): while a photo slideshow plays; the music
//     is steered here, separately from the photos.
//   - Shown briefly (RQ-PLAY-11): a screen showing a camera or clip over its
//     programme says so, and can be closed from here.
//
// Plus the stop guard for TransportBar: stopping a slideshow with music
// behind asks whether to keep the music playing.
import { UiIcon } from '../../../../../frontend/src/lib/ui/UiIcon.jsx';
import React, { useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import {
  IconBadgeCc, IconCheck, IconLanguage, IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled,
  IconPlayerSkipForwardFilled, IconPlayerStopFilled,
} from '@tabler/icons-react';
import { isSlideshowItem, SUBTITLES_OFF } from '@shared-contracts/media/playerFeatures.mjs';
import { useSessionController } from "../controller/useSessionController.js";
import { getLocalPlayerFeatures } from "../session/localPlayerFeatures.js";
import { ContentCombobox } from "../../../../../__capabilities/content-catalog/browser/picker.mjs";
import { SearchContext } from "../search/SearchProvider.jsx";
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { ActionMenu } from '@/lib/ui/ActionMenu.jsx';
import { commandFailureCopy } from "./stateCopy.js";
import mediaLog from "../logging/mediaLog.js";
import { TopMoreMenu } from '@/lib/ui/TopMore.jsx';
import { trackLanguages, trackLanguageRank } from "./trackLanguages.js";
import "./PlayerFeatureControls.scss";

// Off, the current track and the three in the languages used last; the rest under More.
const TRACKS_SHOWN = 3;

const FALLBACK_MUSIC_SCOPE = 'mediaType=audio';
const FAILURE_COPY = {
  NOT_A_SLIDESHOW: 'Music behind needs a photo slideshow playing',
  NO_PLAYBACK: 'Nothing is playing',
  UNKNOWN_TRACK: 'That track is not available',
  NO_BRIEF: 'Nothing is being shown',
};
const failureCopy = (result) => FAILURE_COPY[result?.code]
  ?? commandFailureCopy(result);

const NOOP_SUB = () => () => {};
const NULL_STATE = () => null;

/** The player-feature side of one target: state + commands, local or remote. */
export function usePlayerFeatures(target, snapshotOverride = null) {
  const session = useSessionController(target);
  const isLocal = target === 'local';
  const local = isLocal ? getLocalPlayerFeatures() : null;
  const localState = useSyncExternalStore(local ? local.subscribe : NOOP_SUB, local ? local.getState : NULL_STATE);
  const snapshot = snapshotOverride ?? session.snapshot;
  const controls = snapshot?.controls ?? null;
  const remote = session.controller?.sessionControls ?? null;
  return {
    isLocal,
    snapshot,
    tracks: isLocal ? localState?.tracks ?? null : controls?.tracks ?? null,
    musicBehind: isLocal ? localState?.musicBehind ?? null : controls?.musicBehind ?? null,
    brief: isLocal ? null : controls?.brief ?? null,
    setTracks: isLocal ? (sel) => local.setTracks(sel) : (remote?.setTracks ?? null),
    musicBehindCommand: isLocal ? (op, params) => local.musicBehind(op, params) : (remote?.musicBehind ?? null),
    closeBrief: isLocal ? null : (remote?.closeBrief ?? null),
  };
}

async function settle(promiseOrResult) {
  try {
    const result = await promiseOrResult;
    return result?.ok === false ? result : { ok: true };
  } catch (error) {
    return { ok: false, code: error?.code ?? null, message: error?.message ?? String(error) };
  }
}

// The current choice is marked; the others keep its space so labels line up.
function Mark({ on }) {
  return on ? <IconCheck size={14} aria-label="Selected" /> : <span className="pf-mark-space" aria-hidden="true" />;
}

function TrackMenu({ kind, tracks, selected, onSelect, disabled, compact = false }) {
  const isSubs = kind === 'subtitle';
  const list = isSubs ? tracks.subtitles : tracks.audio;
  const current = list.find((t) => t.id === selected) ?? null;
  const label = isSubs ? `Subtitles: ${current?.label ?? 'Off'}` : `Audio: ${current?.label ?? list[0]?.label ?? '—'}`;
  return (
    // flip + size: open toward the larger free side and never past the
    // viewport — a file can carry dozens of subtitle streams.
    <ActionMenu position="top" withinPortal middlewares={{ flip: true, shift: true, size: { padding: 8 } }}
      dropdownProps={{ 'data-testid': `pf-${isSubs ? 'subtitles' : 'audio'}-menu`, className: 'pf-track-menu' }}
      trigger={compact ? (
        <UnstyledButton
          disabled={disabled}
          aria-label={label}
          title={label}
          data-testid={`pf-${isSubs ? 'subtitles' : 'audio'}`}
          className="pf-chip pf-chip--compact np-rate-btn"
        >
          {isSubs ? <IconBadgeCc size={18} aria-hidden /> : <IconLanguage size={18} aria-hidden />}
          <span className="media-sr-only">{isSubs ? 'Subtitles: ' : 'Audio: '}</span>
          <span className="pf-chip-short">{isSubs ? (current?.label ?? 'Off') : (current?.label ?? list[0]?.label ?? '—')}</span>
        </UnstyledButton>
      ) : (
        <Button
          variant="default" size="sm" disabled={disabled}
          leftSection={isSubs ? <IconBadgeCc size={16} /> : <IconLanguage size={16} />}
          data-testid={`pf-${isSubs ? 'subtitles' : 'audio'}`}
          className="pf-chip"
        >
          {label}
        </Button>
      )}>
      {isSubs && (
        <Menu.Item data-testid="pf-subtitle-off" onClick={() => onSelect({ subtitle: SUBTITLES_OFF })}
          data-selected={!selected || undefined} leftSection={<Mark on={!selected} />}>Off</Menu.Item>
      )}
      <TopMoreMenu
        items={list}
        n={TRACKS_SHOWN}
        rank={trackLanguageRank(trackLanguages().recent(kind), list)}
        keepIds={current ? [current.id] : []}
        testId={`pf-${isSubs ? 'subtitles' : 'audio'}`}
        onExpand={(counts) => mediaLog.listMoreExpanded({ surface: isSubs ? 'subtitles' : 'audio-tracks', ...counts })}
        renderItem={(t) => (
          <Menu.Item
            key={t.id}
            data-selected={t.id === selected || undefined}
            leftSection={<Mark on={t.id === selected} />}
            data-testid={`pf-${isSubs ? 'subtitle' : 'audio'}-${t.id}`}
            onClick={() => {
              trackLanguages().record(kind, t.language);
              onSelect(isSubs ? { subtitle: t.id } : { audio: t.id });
            }}
          >
            {t.label}
          </Menu.Item>
        )}
      />
    </ActionMenu>
  );
}

function MusicPicker({ open, onClose, onPick }) {
  const search = useContext(SearchContext);
  const musicScope = search?.scopes?.find?.((s) => s.key === 'music')?.params ?? FALLBACK_MUSIC_SCOPE;
  return (
    <FormDialog opened={open} onClose={onClose} title="Add music behind" centered size="md">
      <div data-testid="pf-music-picker">
        <Text size="sm" mb="sm">Choose a song, album or playlist. It plays under the photos.</Text>
        {open && <ContentCombobox
          value=""
          onChange={(id, item) => { if (id) onPick(id, item); }}
          placeholder="Search music…"
          selectContainers
          searchParams={musicScope}
          fallbackSearchParams={FALLBACK_MUSIC_SCOPE}
          scopeKey="music"
          scopeLabel="Music"
          logApp="media"
          allowFreeform={false}
        />}
      </div>
    </FormDialog>
  );
}

/** Which tracks an item offers right now: subtitles when it has any, audio when it has a choice. */
function availableTracks(f) {
  const currentItem = f.snapshot?.currentItem ?? null;
  const tracks = f.tracks && (!f.tracks.contentId || !currentItem || f.tracks.contentId === currentItem.contentId) ? f.tracks : null;
  return { tracks, showSubs: !!tracks && tracks.subtitles.length > 0, showAudio: !!tracks && tracks.audio.length > 1 };
}

/**
 * Subtitles / Audio as compact buttons for the control bar (Now Playing
 * ruling 2026-11-27): Off, the current one and the three languages used last;
 * the rest under More. Nothing when the item has no choice to make.
 */
export function TrackButtons({ target, snapshot: snapshotOverride = null }) {
  const f = usePlayerFeatures(target, snapshotOverride);
  const targetName = f.isLocal ? 'local' : target?.deviceId ?? 'unknown';
  const { tracks, showSubs, showAudio } = availableTracks(f);
  if (!showSubs && !showAudio) return null;
  const select = (sel) => {
    mediaLog.playerFeature({ feature: 'tracks', action: 'select', target: targetName });
    settle(Promise.resolve().then(() => f.setTracks(sel))).then((result) => {
      if (result.ok === false) mediaLog.playerFeatureFailed({ feature: 'tracks', action: 'select', target: targetName, code: result.code ?? null });
    });
  };
  return (
    <>
      {showSubs && <TrackMenu compact kind="subtitle" tracks={tracks} selected={tracks.selected?.subtitle ?? null}
        disabled={!f.setTracks} onSelect={select} />}
      {showAudio && <TrackMenu compact kind="audio" tracks={tracks} selected={tracks.selected?.audio ?? null}
        disabled={!f.setTracks} onSelect={select} />}
    </>
  );
}

export function PlayerFeatureControls({ target, snapshot: snapshotOverride = null, withTracks = true }) {
  const f = usePlayerFeatures(target, snapshotOverride);
  const [feedback, setFeedback] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const targetName = f.isLocal ? 'local' : target?.deviceId ?? 'unknown';

  const run = useCallback(async (feature, action, operation) => {
    setFeedback(null);
    mediaLog.playerFeature({ feature, action, target: targetName });
    const result = await settle(operation());
    if (result.ok === false) {
      mediaLog.playerFeatureFailed({ feature, action, target: targetName, code: result.code ?? null });
      setFeedback(failureCopy(result));
    }
  }, [targetName]);

  const currentItem = f.snapshot?.currentItem ?? null;
  const available = availableTracks(f);
  const tracks = available.tracks;
  const showSubs = withTracks && available.showSubs;
  const showAudio = withTracks && available.showAudio;
  const slideshow = isSlideshowItem(currentItem);
  const music = f.musicBehind;

  if (!showSubs && !showAudio && !slideshow && !music && !f.brief) return null;

  return (
    <div className="pf-controls" data-testid="pf-controls">
      {f.brief && (
        <div className="pf-row pf-brief" data-testid="pf-brief" role="status">
          <Text size="sm" className="pf-brief-label">{`Showing ${f.brief.label}`}{f.brief.remainingSeconds != null ? ` · ${f.brief.remainingSeconds}s` : ''}</Text>
          {f.closeBrief && (
            <Button size="sm" variant="default" leftSection={<UiIcon name="close" />} data-testid="pf-brief-close"
              onClick={() => run('brief', 'close', () => f.closeBrief())}>Close</Button>
          )}
        </div>
      )}
      {(showSubs || showAudio) && (
        <Group className="pf-row" gap="sm" justify="center">
          {showSubs && <TrackMenu kind="subtitle" tracks={tracks} selected={tracks.selected?.subtitle ?? null}
            disabled={!f.setTracks} onSelect={(sel) => run('tracks', 'select', () => f.setTracks(sel))} />}
          {showAudio && <TrackMenu kind="audio" tracks={tracks} selected={tracks.selected?.audio ?? null}
            disabled={!f.setTracks} onSelect={(sel) => run('tracks', 'select', () => f.setTracks(sel))} />}
        </Group>
      )}
      {music ? (
        <Group className="pf-row pf-music" gap="sm" justify="center" data-testid="pf-music" data-music-state={music.state}>
          <IconMusic size={16} aria-hidden="true" />
          {/* Named, so its Stop is never mistaken for the slideshow's. */}
          <Text size="sm" c="dimmed">Music behind</Text>
          <Text size="sm" className="pf-music-title" data-testid="pf-music-title">{music.trackTitle ?? music.title ?? 'Music'}</Text>
          <Button size="sm" variant="default" data-testid="pf-music-toggle" aria-label={music.state === 'playing' ? 'Pause music' : 'Play music'}
            onClick={() => run('music-behind', music.state === 'playing' ? 'pause' : 'play',
              () => f.musicBehindCommand(music.state === 'playing' ? 'pause' : 'play'))}>
            {music.state === 'playing' ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
          </Button>
          <Button size="sm" variant="default" data-testid="pf-music-next" aria-label="Next song"
            onClick={() => run('music-behind', 'next', () => f.musicBehindCommand('next'))}>
            <IconPlayerSkipForwardFilled size={16} />
          </Button>
          <Button size="sm" variant="default" data-testid="pf-music-stop" aria-label="Stop music"
            onClick={() => run('music-behind', 'stop', () => f.musicBehindCommand('stop'))}>
            <IconPlayerStopFilled size={16} />
          </Button>
        </Group>
      ) : slideshow && (
        <Group className="pf-row" justify="center">
          <Button size="sm" variant="default" leftSection={<IconMusic size={16} />} data-testid="pf-music-add"
            disabled={!f.musicBehindCommand} onClick={() => setPickerOpen(true)}>Add music behind</Button>
        </Group>
      )}
      <MusicPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(contentId, item) => {
          setPickerOpen(false);
          run('music-behind', 'start', () => f.musicBehindCommand('start', { contentId, title: item?.title ?? null }));
        }}
      />
      {feedback && <div className="pf-feedback" role="status" data-testid="pf-feedback">{feedback}</div>}
    </div>
  );
}

/**
 * Stopping a slideshow with music behind asks whether to keep the music
 * (PLAY.9a/AC3). Returns [guardStop(stop, opener), dialog] for TransportBar.
 */
export function useSlideshowStopGuard(target, snapshotOverride = null, { available = true } = {}) {
  const f = usePlayerFeatures(target, snapshotOverride);
  const [pending, setPending] = useState(null);
  const targetKey = f.isLocal ? 'local' : target?.deviceId;
  const ask = available && isSlideshowItem(f.snapshot?.currentItem) && !!f.musicBehind && !!f.musicBehindCommand;
  const open = Boolean(ask && pending && pending.targetKey === targetKey);
  // `stop` receives { keepMusic } — the explicit answer, sent on the stop
  // command so the screen never has to guess it from who sent the Stop.
  const guardStop = useCallback((stop, opener) => {
    if (!ask) { stop({ keepMusic: false }); return; }
    opener?.focus({ preventScroll: true });
    setPending({ stop, opener, targetKey });
  }, [ask, targetKey]);
  const close = useCallback(() => setPending(null), []);
  useLayoutEffect(() => {
    if (!pending || open) return;
    setPending(null);
    const { opener } = pending;
    if (!available || pending.targetKey !== targetKey || !opener?.isConnected) return;
    // Eligibility can remove the modal before Mantine's focus return runs.
    queueMicrotask(() => {
      if (opener.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true });
    });
  }, [available, open, pending, targetKey]);
  // Keep the modal mounted while this prompt is available so Mantine can return focus on cancel.
  const dialog = useMemo(() => !ask && !pending ? null : (
    <FormDialog key={targetKey} opened={open} onClose={close} title="Stop the slideshow" centered size="sm">
      {open && <div data-testid="pf-stop-guard">
        <Text size="sm" mb="md">Keep the music playing?</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" data-testid="pf-stop-cancel" onClick={close}>Cancel</Button>
          <Button variant="default" data-testid="pf-stop-both" onClick={() => {
            const { stop } = pending; close();
            mediaLog.playerFeature({ feature: 'music-behind', action: 'stop-with-slideshow', target: f.isLocal ? 'local' : target?.deviceId });
            stop?.({ keepMusic: false });
            Promise.resolve(f.musicBehindCommand('stop')).catch(() => {});
          }}>Stop music too</Button>
          <Button data-testid="pf-stop-keep-music" onClick={() => {
            const { stop } = pending; close();
            mediaLog.playerFeature({ feature: 'music-behind', action: 'keep-after-slideshow', target: f.isLocal ? 'local' : target?.deviceId });
            if (f.isLocal) getLocalPlayerFeatures().keepMusicAfterStop();
            stop?.({ keepMusic: true });
          }}>Keep music</Button>
        </Group>
      </div>}
    </FormDialog>
  ), [ask, open, pending, close, f, target, targetKey]);
  return [guardStop, dialog];
}

export default PlayerFeatureControls;
