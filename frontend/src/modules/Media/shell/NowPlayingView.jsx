// frontend/src/modules/Media/shell/NowPlayingView.jsx
// Full local player surface. Claims the player host so the ambient Player's
// visual output portals here; navigation away releases the host and audio
// continues from the hidden mount. Renders artwork + metadata (title and the
// show/album the item came from — never raw ids), the seek row, and the full
// transport. Playback-speed control gets the portaled media element found
// inside the claimed host (the only rate pathway; see TransportBar).
import React, { useEffect, useRef, useState } from 'react';
import { IconArrowsMinimize, IconMaximize, IconChevronLeft } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useNav } from './NavProvider.jsx';
import { TransportBar } from './TransportBar.jsx';
import { SeekBar } from './SeekBar.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { playbackStateLabel, queuePositionLabel } from './stateCopy.js';
import { SessionControlFrame } from '../controller/SessionControlFrame.jsx';
import { DestinationLine } from '../cast/DestinationLine.jsx';
import { SessionControlsPanel } from './SessionControlsPanel.jsx';
import { LineUpOffer } from './LineUpOffer.jsx';
import './NowPlaying.scss';

function useIsPhone() {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

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

export function NowPlayingView() {
  const { controller, snapshot, portability } = useSessionController('local');
  const item = snapshot?.currentItem;
  const hostRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  usePlayerHost(hostRef, 2, true, { forceShader: expanded ? 'focused' : null });
  const hasActualVideoNode = useActualVideoNode(controller, hostRef, item?.contentId ?? null);
  const { pop, backDestination } = useNav();
  const isPhone = useIsPhone();

  useEffect(() => setExpanded(false), [item?.contentId]);

  // The queue entry behind the current item carries display context the slim
  // currentItem does not (containerTitle = the show/album it expanded from).
  const queueItems = snapshot?.queue?.items ?? [];
  const currentIndex = snapshot?.queue?.currentIndex ?? -1;
  const currentEntry = currentIndex >= 0 ? queueItems[currentIndex] : null;
  // Context line: the show/album the item expanded from (containerTitle), or
  // for a track played straight from search, its "<artist> — <album>".
  const trackContext = [currentEntry?.artist ?? item?.artist, currentEntry?.album ?? item?.album]
    .filter(Boolean)
    .join(' — ');
  const containerTitle = currentEntry?.containerTitle ?? (trackContext || null);
  const positionLabel = queuePositionLabel(currentIndex, queueItems.length);
  // Never surface a raw content id as a metadata line.
  const metaTitle = typeof item?.title === 'string' && item.title !== item.contentId
    ? item.title
    : null;
  // The seek bar already shows the length; the meta line carries the queue position only.
  const metaSubParts = [positionLabel].filter(Boolean);
  const isVideo = item?.format === 'video'
    || item?.format === 'dash_video'
    || item?.format === 'hls_video'
    || item?.mediaType === 'video'
    || item?.mediaType === 'dash_video'
    || item?.mediaType === 'hls_video'
    || hasActualVideoNode;
  const isAudio = item?.format === 'audio' || item?.mediaType === 'audio';
  const posterBehindHost = !!item?.thumbnail && isVideo;
  const expandableKind = isVideo ? 'video' : (isAudio ? 'audio' : null);

  // Paused / Expand video sit in the title row when the meta block shows, else in the toolbar.
  const showMeta = !!item && (!expanded || isAudio);
  const statusBlock = (
        <div className="np-toolbar-status">
          <span className="np-state" data-testid="np-state" data-state={snapshot?.state ?? ''}>
            {playbackStateLabel(snapshot?.state)}
          </span>
          {item && expandableKind && (
            <button
              type="button"
              className="np-expand-btn"
              aria-label={expanded ? `Shrink ${expandableKind}` : `Expand ${expandableKind}`}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <IconArrowsMinimize size={20} /> : <IconMaximize size={20} />}
              <span>{expanded ? `Shrink ${expandableKind}` : `Expand ${expandableKind}`}</span>
            </button>
          )}
        </div>
  );

  return (
    <div
      data-testid="now-playing-view"
      className={`now-playing-view ${expanded ? 'now-playing-view--expanded' : ''}`}
    >
      <div className="now-playing-toolbar">
        <button
          type="button"
          data-testid="now-playing-back"
          className="np-back-btn"
          onClick={() => pop()}
        >
          <IconChevronLeft size={16} aria-hidden /> {backDestination ?? 'Home'}
        </button>
        {!showMeta && statusBlock}
      </div>

      {/* One title block: the info block below names the item; this heading is
          the visible title only when there is no current item, and stays as the
          screen-reader / test heading otherwise. */}
      <h1
        className={`now-playing-title${item ? ' media-sr-only' : ''}`}
        data-testid="now-playing-title"
        data-content-id={item?.contentId ?? ''}
      >
        {item
          ? `Now Playing: ${item.title ?? item.contentId}`
          : (queueItems.length > 0 ? `Ready to play: ${queueItems[0].title ?? queueItems[0].contentId}` : 'Nothing playing')}
      </h1>

      {/* A paused or not-yet-started video shows its own poster, not a black box. */}
      <div
        data-testid="now-playing-host"
        ref={hostRef}
        className={`now-playing-host${posterBehindHost ? ' now-playing-host--poster' : ''}`}
        style={posterBehindHost ? { backgroundImage: `url("${item.thumbnail}")` } : undefined}
      />

      {/* The header's destination control carries the aim on every view; on a phone it
          is out of thumb reach, so Now Playing repeats it there (RELY.12a). */}
      {isPhone && <DestinationLine surface="now-playing" />}
      <SessionControlFrame targetKind="local">
        {item && (
        <>
          {showMeta && <div className="np-meta" data-testid="np-meta">
            {item.thumbnail && !isVideo && (
              <img className="np-art" data-testid="np-meta-art" src={item.thumbnail} alt="" loading="lazy" />
            )}
            <div className="np-meta-lines">
              {metaTitle && <span className="np-meta-title" data-testid="np-meta-title">{metaTitle}</span>}
              {containerTitle && (
                <span className="np-meta-context" data-testid="np-meta-context">{containerTitle}</span>
              )}
              {metaSubParts.length > 0 && (
                <span className="np-meta-sub" data-testid="np-meta-sub">
                  {metaSubParts.map((part, i) => (
                    <React.Fragment key={part}>
                      {i > 0 && <span className="np-meta-dot" aria-hidden="true">·</span>}
                      {part}
                    </React.Fragment>
                  ))}
                </span>
              )}
            </div>
            {statusBlock}
          </div>}
          <SeekBar target="local" />
          <TransportBar target="local" />
        </>
        )}
        {(item || snapshot?.queue?.items?.length > 0) && <SessionControlsPanel target="local" />}
        {item && <LineUpOffer target="local" />}

        {!expanded && <QueuePanel target="local" />}
      </SessionControlFrame>

      {item && !expanded && (
        <div className="handoff-section" data-testid="handoff-section">
          <div className="np-handoff-label">Send to another device</div>
          <DispatchTargetPicker
            source={{ getSnapshot: () => portability.snapshotForHandoff?.(), title: item.title ?? null }}
            verb="Hand off"
            autoFocus={false}
          />
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
