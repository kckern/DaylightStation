// frontend/src/modules/Media/shell/NowPlayingView.jsx
// Full local player surface. Claims the player host so the ambient Player's
// visual output portals here; navigation away releases the host and audio
// continues from the hidden mount. Renders artwork + metadata (title and the
// show/album the item came from — never raw ids), the seek row, and the full
// transport. Playback-speed control gets the portaled media element found
// inside the claimed host (the only rate pathway; see TransportBar).
import React, { useEffect, useRef, useState } from 'react';
import { IconArrowsMinimize, IconMaximize, IconMusic } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useNav } from './NavProvider.jsx';
import { TransportBar } from './TransportBar.jsx';
import { SeekBar } from './SeekBar.jsx';
import { formatTime } from './formatTime.js';
import { QueuePanel } from './QueuePanel.jsx';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { playbackStateLabel, queuePositionLabel } from './stateCopy.js';
import { SessionControlFrame } from '../controller/SessionControlFrame.jsx';
import { AimLabel } from '../cast/AimLabel.jsx';
import './NowPlaying.scss';

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
  const durationLabel = item?.duration ? formatTime(item.duration) : null;
  const metaSubParts = [positionLabel, durationLabel].filter(Boolean);
  const isVideo = item?.format === 'video'
    || item?.format === 'dash_video'
    || item?.format === 'hls_video'
    || item?.mediaType === 'video'
    || item?.mediaType === 'dash_video'
    || item?.mediaType === 'hls_video'
    || hasActualVideoNode;
  const isAudio = item?.format === 'audio' || item?.mediaType === 'audio';
  const expandableKind = isVideo ? 'video' : (isAudio ? 'audio' : null);

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
          ← {backDestination ?? 'Home'}
        </button>
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
      </div>

      <h1
        className="now-playing-title"
        data-testid="now-playing-title"
        data-content-id={item?.contentId ?? ''}
      >
        {item ? `Now Playing: ${item.title ?? item.contentId}` : 'Nothing playing'}
      </h1>

      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />

      <AimLabel targetIds={[]} devices={[]} />
      <SessionControlFrame targetKind="local">
        {item && (
        <>
          {(!expanded || isAudio) && <div className="np-meta" data-testid="np-meta">
            {item.thumbnail ? (
              <img className="np-art" data-testid="np-meta-art" src={item.thumbnail} alt="" loading="lazy" />
            ) : (
              <div className="np-art-placeholder" aria-hidden="true">
                <IconMusic size={40} />
              </div>
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
          </div>}
          <SeekBar target="local" />
          <TransportBar target="local" targetLabel="This device" />
        </>
        )}

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
