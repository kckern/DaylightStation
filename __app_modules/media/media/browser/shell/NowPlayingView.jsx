// shell/NowPlayingView.jsx
// This device's player (Now Playing ruling, 2026-11-27): ONE hero — the video
// inline (Expand makes it fill the view) or the art, the title once, a
// subtitle (show · season/episode, or artist · album), and where it plays —
// then one control bar (TransportBar: transport in the centre; speed, volume
// steps, tracks, Play on… and More ⋯ at the end) and the queue around what
// plays now. Nothing else repeats it: the bottom bar hides on this view
// (nowPlayingModel.miniBarVisible), Played earlier lives on Home, and sending
// it elsewhere is the one Play on… picker.
//
// Claims the player host so the ambient Player's visual output portals here;
// navigation away releases the host and audio continues from the hidden
// mount. Playback-speed control goes through the session controller only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import { useCompactViewport } from '@/lib/ui/useCompactViewport.js';
import { useSessionController } from "../controller/useSessionController.js";
import { useSessionControls, secondsUntil, formatClock } from "../controller/useSessionControls.js";
import { useDisplayClock } from '@/lib/hooks/useDisplayClock.js';
import { usePlayerHost } from "../session/usePlayerHost.js";
import { useNav } from "./NavProvider.jsx";
import { TransportBar } from "./TransportBar.jsx";
import { SeekBar } from "./SeekBar.jsx";
import { QueuePanel } from "./QueuePanel.jsx";
import { PlayOnButton } from "./PlayOnButton.jsx";
import { playbackStateLabel } from "./stateCopy.js";
import { SessionControlFrame } from "../controller/SessionControlFrame.jsx";
import { DestinationLine } from "../cast/DestinationLine.jsx";
import { SessionControlsPanel, SessionControlMenuItems } from "./SessionControlsPanel.jsx";
import { LineUpOffer } from "./LineUpOffer.jsx";
import { AddToHomeScreenItem } from "./AddToHomeScreenButton.jsx";
import { pinTarget } from "./homeScreenPin.js";
import { heroSubtitle, heroStateWord, wherePlayingLabel, seekKeyStep } from "./nowPlayingModel.js";
import { QualityMenuItem } from "../quality/PlaybackQualityButtons.jsx";
import mediaLog from "../logging/mediaLog.js";
import "./NowPlaying.scss";

// Controls hide after this long without a pointer move while an expanded video plays.
export const CONTROLS_IDLE_MS = 3000;

// Format enrichment may not arrive before a paused/autoplay-blocked video
// renders. The native node is read only: it restores the visual affordance but
// never controls rate, seek, or playback outside the session controller.
function useActualVideoNode(controller, hostRef, itemKey) {
  const [isVideo, setIsVideo] = useState(false);
  useEffect(() => {
    const inspect = () => {
      const node = controller?.getMediaElement?.()
        ?? hostRef.current?.querySelector?.('video')
        ?? null;
      const next = node?.tagName?.toLowerCase?.() === 'video';
      setIsVideo((previous) => (previous === next ? previous : next));
    };
    inspect();
    const host = hostRef.current;
    if (!host || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(inspect);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [controller, hostRef, itemKey]);
  return isVideo;
}

/** The sleep timer's time left, for the hero's status line (the bar is hidden here). */
function useSleepStatus() {
  const { controls } = useSessionControls('local');
  const sleepTimer = controls?.sleepTimer ?? null;
  const now = useDisplayClock(sleepTimer?.mode === 'minutes');
  if (!sleepTimer) return null;
  if (sleepTimer.mode === 'atEnd') return 'sleeps at the end';
  return `sleeps in ${formatClock(secondsUntil(sleepTimer.endsAt, now) ?? sleepTimer.remainingSeconds)}`;
}

/**
 * While an expanded video plays, the controls fade after CONTROLS_IDLE_MS of
 * no pointer movement and return on any move, touch or key. Focus inside the
 * controls keeps them up.
 */
function useIdleControls(active, rootRef) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(null);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    if (!active) return;
    const hide = () => {
      // A menu open in the bar (⚙, More ⋯, tracks) holds the controls up.
      if (rootRef.current?.querySelector?.('[role="menu"]')) {
        timer.current = setTimeout(hide, CONTROLS_IDLE_MS);
        return;
      }
      setIdle(true);
    };
    timer.current = setTimeout(hide, CONTROLS_IDLE_MS);
  }, [active, rootRef]);
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake]);
  return { idle: active && idle, wake };
}

export function NowPlayingView({ destinationControlRef = null }) {
  const { controller, snapshot, portability, transport } = useSessionController('local');
  const item = snapshot?.currentItem;
  const hostRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  usePlayerHost(hostRef, 2, true, { forceShader: expanded ? 'focused' : null });
  const hasActualVideoNode = useActualVideoNode(controller, hostRef, item?.contentId ?? null);
  const { pop, backDestination } = useNav();
  const isPhone = useCompactViewport();
  const sleepStatus = useSleepStatus();

  useEffect(() => setExpanded(false), [item?.contentId]);

  const queueItems = snapshot?.queue?.items ?? [];
  const currentIndex = snapshot?.queue?.currentIndex ?? -1;
  // The queue entry behind the current item carries display context the slim
  // currentItem does not (containerTitle = the show/album it expanded from).
  const currentEntry = currentIndex >= 0 ? queueItems[currentIndex] : null;
  const readyItem = !item && queueItems.length > 0 ? queueItems[0] : null;
  const shown = item ?? readyItem;
  // Never surface a raw content id as the title.
  const title = typeof shown?.title === 'string' && shown.title !== shown.contentId ? shown.title : null;
  const subtitle = heroSubtitle(shown, item ? currentEntry : readyItem);
  const homeScreenTarget = pinTarget(item, currentEntry);
  const isVideo = item?.format === 'video'
    || item?.format === 'dash_video'
    || item?.format === 'hls_video'
    || item?.mediaType === 'video'
    || item?.mediaType === 'dash_video'
    || item?.mediaType === 'hls_video'
    || hasActualVideoNode;
  const isAudio = !!item && !isVideo;
  const posterBehindHost = !!item?.thumbnail && isVideo;
  const playing = snapshot?.state === 'playing' || snapshot?.state === 'buffering';
  const viewRef = useRef(null);
  const { idle, wake } = useIdleControls(expanded && isVideo && playing, viewRef);

  const mountLogged = useRef(false);
  useEffect(() => {
    if (mountLogged.current) return;
    mountLogged.current = true;
    mediaLog.nowPlayingMounted({
      kind: item ? (isVideo ? 'video' : 'audio') : (readyItem ? 'ready' : 'empty'),
      contentId: item?.contentId ?? null,
      queueLength: queueItems.length,
      compact: isPhone,
    });
  }, [item, isVideo, readyItem, queueItems.length, isPhone]);

  const toggleExpanded = useCallback(() => {
    setExpanded((value) => {
      mediaLog.nowPlayingExpanded({ expanded: !value, kind: isVideo ? 'video' : 'audio' });
      return !value;
    });
  }, [isVideo]);

  // ← / → seek 10 s while nothing is being typed; Esc leaves the expanded video.
  const seekBy = (event) => {
    const step = seekKeyStep(event);
    if (step == null || !item || typeof transport?.seekRel !== 'function') return false;
    wake();
    try { Promise.resolve(transport.seekRel(step)).catch(() => {}); } catch { /* reported by the controller */ }
    return true;
  };
  useHotkey('arrowleft', seekBy, { allowRepeat: true });
  useHotkey('arrowright', seekBy, { allowRepeat: true });
  useHotkey('escape', () => {
    if (!expanded) return false;
    setExpanded(false);
    mediaLog.nowPlayingExpanded({ expanded: false, kind: isVideo ? 'video' : 'audio', via: 'escape' });
    return true;
  });

  const expandable = !!item && (isVideo || isAudio);
  const expandKind = isVideo ? 'video' : 'audio';
  const expandLabel = expanded ? `Shrink ${expandKind}` : `Expand ${expandKind}`;
  const expandControl = expandable ? (
    <Tooltip label={expanded ? `${expandLabel} (Esc)` : expandLabel} withinPortal>
      <ActionIcon
        data-testid="np-expand"
        className="np-icon-btn"
        variant="default"
        size={40}
        radius="xl"
        aria-label={expandLabel}
        onClick={toggleExpanded}
      >
        {expanded ? <IconArrowsMinimize size={20} /> : <IconArrowsMaximize size={20} />}
      </ActionIcon>
    </Tooltip>
  ) : null;

  // The play/pause button already says Playing; the hero names any other state.
  const stateWord = item ? heroStateWord(snapshot?.state) : (readyItem ? 'Ready to play' : null);
  const where = item ? wherePlayingLabel({ local: true }) : null;
  const titleBlock = (
    <div className="np-titles">
      <h1
        className="now-playing-title"
        data-testid="now-playing-title"
        data-content-id={item?.contentId ?? ''}
      >
        {/* The page's heading; the words a screen reader hears first. */}
        <span className="media-sr-only">{item ? 'Now Playing: ' : (readyItem ? 'Ready to play: ' : '')}</span>
        {/* No title yet (still loading its details): nothing rather than a raw id or "Untitled". */}
        {shown ? title : 'Nothing playing'}
      </h1>
      {subtitle && <div className="np-subtitle" data-testid="np-meta-context">{subtitle}</div>}
      {(stateWord || where) && (
        <div className="np-where">
          <span
            className={stateWord ? 'np-state' : 'np-state media-sr-only'}
            data-testid="np-state"
            data-state={snapshot?.state ?? ''}
          >
            {stateWord ?? playbackStateLabel(snapshot?.state)}
          </span>
          {stateWord && where && <span aria-hidden="true"> · </span>}
          {where && <span className="np-where-name" data-testid="np-where">{stateWord ? where : where.replace(/^on /, 'Playing on ')}</span>}
          {sleepStatus && <span className="np-sleep" data-testid="np-sleep"> · {sleepStatus}</span>}
        </div>
      )}
    </div>
  );

  // ⚙ holds the rare per-item settings (Speed is TransportBar's own); More ⋯
  // holds Stop and the session settings (owner rulings 2026-11-27).
  const settingsItems = <QualityMenuItem target="local" targetLabel="this device" />;
  const moreItems = (
    <>
      <SessionControlMenuItems target="local" />
      <AddToHomeScreenItem target={homeScreenTarget} />
    </>
  );

  return (
    <div
      data-testid="now-playing-view"
      ref={viewRef}
      className={[
        'now-playing-view',
        expanded ? 'now-playing-view--expanded' : '',
        isAudio ? 'now-playing-view--audio' : '',
        isVideo ? 'now-playing-view--video' : '',
        idle ? 'np-idle' : '',
      ].filter(Boolean).join(' ')}
      onPointerMove={wake}
      onPointerDown={wake}
      onKeyDownCapture={wake}
    >
      {!expanded && (
        <div className="now-playing-toolbar">
          <UnstyledButton
            data-testid="now-playing-back"
            className="np-back-btn"
            onClick={() => pop()}
          >
            <UiIcon name="back" /> {backDestination ?? 'Home'}
          </UnstyledButton>
        </div>
      )}

      <div className="np-layout">
        <section className="np-hero" aria-label="Now playing">
          <div className="np-stage">
            {/* A paused or not-yet-started video shows its own poster, not a black box. */}
            <div
              data-testid="now-playing-host"
              ref={hostRef}
              className={`now-playing-host${posterBehindHost ? ' now-playing-host--poster' : ''}`}
              style={posterBehindHost ? { backgroundImage: `url("${item.thumbnail}")` } : undefined}
            />
            {((shown?.thumbnail && !isVideo) || !expanded) && (
              <div className="np-head">
                {shown?.thumbnail && !isVideo && (
                  <img className="np-art" data-testid="np-meta-art" src={shown.thumbnail} alt="" loading="lazy" />
                )}
                {!expanded && titleBlock}
              </div>
            )}
            <SessionControlFrame targetKind="local">
              {item && <SeekBar target="local" />}
              {shown && (
                <TransportBar
                  seekReason={false}
                  target="local"
                  lead={expanded ? titleBlock : null}
                  playOn={item ? (
                    <PlayOnButton
                      getSnapshot={() => portability.snapshotForHandoff?.()}
                      title={item.title ?? null}
                    />
                  ) : null}
                  moreItems={moreItems}
                  settingsItems={settingsItems}
                  trailing={expandControl}
                />
              )}
              {(item || queueItems.length > 0) && <SessionControlsPanel target="local" />}
              {item && <LineUpOffer target="local" />}
            </SessionControlFrame>
          </div>
        </section>

        {!expanded && (
          <section className="np-queue" aria-label="Up next">
            <SessionControlFrame targetKind="local">
              <QueuePanel target="local" showPlayedEarlier={false} />
            </SessionControlFrame>
            {/* The aim (where the next ▶ goes) at the thumb on a phone (RELY.12a);
                after the queue, so it never sits in the hero. */}
            {isPhone && <DestinationLine surface="now-playing" focusReturnRef={destinationControlRef} />}
          </section>
        )}
      </div>
    </div>
  );
}

export default NowPlayingView;
