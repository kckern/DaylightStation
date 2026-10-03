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
import React, { useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Group, Menu, Modal, Text } from '@mantine/core';
import {
  IconBadgeCc, IconCheck, IconLanguage, IconMusic, IconPlayerPauseFilled, IconPlayerPlayFilled,
  IconPlayerSkipForwardFilled, IconPlayerStopFilled, IconX,
} from '@tabler/icons-react';
import { isSlideshowItem, SUBTITLES_OFF } from '@shared-contracts/media/playerFeatures.mjs';
import { useSessionController } from '../controller/useSessionController.js';
import { getLocalPlayerFeatures } from '../session/localPlayerFeatures.js';
import { ContentCombobox } from '../../Content/combobox/ContentCombobox.jsx';
import { SearchContext } from '../search/SearchProvider.jsx';
import { useDismissLayer } from './useDismissLayer.js';
import mediaLog from '../logging/mediaLog.js';
import './PlayerFeatureControls.scss';

const FALLBACK_MUSIC_SCOPE = 'mediaType=audio';
const FAILURE_COPY = {
  NOT_A_SLIDESHOW: 'Music behind needs a photo slideshow playing',
  NO_PLAYBACK: 'Nothing is playing',
  UNKNOWN_TRACK: 'That track is not available',
  NO_BRIEF: 'Nothing is being shown',
  DEVICE_OFFLINE: 'Not sent — device is offline',
};
const failureCopy = (result) => FAILURE_COPY[result?.code]
  ?? (/\bDEVICE_OFFLINE\b/.test(String(result?.message ?? '')) ? FAILURE_COPY.DEVICE_OFFLINE : 'Could not confirm change');

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

function TrackMenu({ kind, tracks, selected, onSelect, disabled }) {
  const isSubs = kind === 'subtitle';
  const list = isSubs ? tracks.subtitles : tracks.audio;
  const current = list.find((t) => t.id === selected) ?? null;
  const label = isSubs ? `Subtitles: ${current?.label ?? 'Off'}` : `Audio: ${current?.label ?? list[0]?.label ?? '—'}`;
  return (
    <Menu position="top" withinPortal>
      <Menu.Target>
        <Button
          variant="default" size="sm" disabled={disabled}
          leftSection={isSubs ? <IconBadgeCc size={16} /> : <IconLanguage size={16} />}
          data-testid={`pf-${isSubs ? 'subtitles' : 'audio'}`}
          className="pf-chip"
        >
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown data-testid={`pf-${isSubs ? 'subtitles' : 'audio'}-menu`}>
        {isSubs && (
          <Menu.Item data-testid="pf-subtitle-off" onClick={() => onSelect({ subtitle: SUBTITLES_OFF })}
            data-selected={!selected || undefined} leftSection={<Mark on={!selected} />}>Off</Menu.Item>
        )}
        {list.map((t) => (
          <Menu.Item
            key={t.id}
            data-selected={t.id === selected || undefined}
            leftSection={<Mark on={t.id === selected} />}
            data-testid={`pf-${isSubs ? 'subtitle' : 'audio'}-${t.id}`}
            onClick={() => onSelect(isSubs ? { subtitle: t.id } : { audio: t.id })}
          >
            {t.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function MusicPicker({ open, onClose, onPick }) {
  const search = useContext(SearchContext);
  const musicScope = search?.scopes?.find?.((s) => s.key === 'music')?.params ?? FALLBACK_MUSIC_SCOPE;
  useDismissLayer(open, onClose, { managed: true });
  return (
    <Modal opened={open} onClose={onClose} title="Add music behind" centered size="md">
      <div data-testid="pf-music-picker">
        <Text size="sm" mb="sm">Choose a song, album or playlist. It plays under the photos.</Text>
        <ContentCombobox
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
        />
      </div>
    </Modal>
  );
}

export function PlayerFeatureControls({ target, snapshot: snapshotOverride = null }) {
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
  const tracks = f.tracks && (!f.tracks.contentId || !currentItem || f.tracks.contentId === currentItem.contentId) ? f.tracks : null;
  const showSubs = !!tracks && tracks.subtitles.length > 0;
  const showAudio = !!tracks && tracks.audio.length > 1;
  const slideshow = isSlideshowItem(currentItem);
  const music = f.musicBehind;

  if (!showSubs && !showAudio && !slideshow && !music && !f.brief) return null;

  return (
    <div className="pf-controls" data-testid="pf-controls">
      {f.brief && (
        <div className="pf-row pf-brief" data-testid="pf-brief" role="status">
          <Text size="sm" className="pf-brief-label">{`Showing ${f.brief.label}`}{f.brief.remainingSeconds != null ? ` · ${f.brief.remainingSeconds}s` : ''}</Text>
          {f.closeBrief && (
            <Button size="sm" variant="default" leftSection={<IconX size={16} />} data-testid="pf-brief-close"
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
      {pickerOpen && <MusicPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(contentId, item) => {
          setPickerOpen(false);
          run('music-behind', 'start', () => f.musicBehindCommand('start', { contentId, title: item?.title ?? null }));
        }}
      />}
      {feedback && <div className="pf-feedback" role="status" data-testid="pf-feedback">{feedback}</div>}
    </div>
  );
}

/**
 * Stopping a slideshow with music behind asks whether to keep the music
 * (PLAY.9a/AC3). Returns [guardStop(stop), dialog] for TransportBar.
 */
export function useSlideshowStopGuard(target, snapshotOverride = null) {
  const f = usePlayerFeatures(target, snapshotOverride);
  const [pending, setPending] = useState(null);
  const ask = isSlideshowItem(f.snapshot?.currentItem) && !!f.musicBehind && !!f.musicBehindCommand;
  const guardStop = useCallback((stop) => {
    if (!ask) { stop(); return; }
    setPending(() => stop);
  }, [ask]);
  const close = useCallback(() => setPending(null), []);
  useDismissLayer(!!pending, close, { managed: true });
  const dialog = useMemo(() => (!pending ? null : (
    <Modal opened onClose={close} title="Stop the slideshow" centered size="sm">
      <div data-testid="pf-stop-guard">
        <Text size="sm" mb="md">Keep the music playing?</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" data-testid="pf-stop-cancel" onClick={close}>Cancel</Button>
          <Button variant="default" data-testid="pf-stop-both" onClick={() => {
            const stop = pending; setPending(null);
            mediaLog.playerFeature({ feature: 'music-behind', action: 'stop-with-slideshow', target: f.isLocal ? 'local' : target?.deviceId });
            stop?.();
            Promise.resolve(f.musicBehindCommand('stop')).catch(() => {});
          }}>Stop music too</Button>
          <Button data-testid="pf-stop-keep-music" onClick={() => {
            const stop = pending; setPending(null);
            mediaLog.playerFeature({ feature: 'music-behind', action: 'keep-after-slideshow', target: f.isLocal ? 'local' : target?.deviceId });
            stop?.();
          }}>Keep music</Button>
        </Group>
      </div>
    </Modal>
  )), [pending, close, f, target]);
  return [guardStop, dialog];
}

export default PlayerFeatureControls;
