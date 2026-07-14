// frontend/src/modules/Media/shell/NowPlayingView.jsx
// Full local player surface. Claims the player host so the ambient Player's
// visual output portals here; navigation away releases the host and audio
// continues from the hidden mount. Renders artwork + metadata (title and the
// show/album the item came from — never raw ids), the seek row, and the full
// transport. Playback-speed control gets the portaled media element found
// inside the claimed host (the only rate pathway; see TransportBar).
import React, { useEffect, useRef, useState } from 'react';
import { IconMusic } from '@tabler/icons-react';
import { useSessionController } from '../controller/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useNav } from './NavProvider.jsx';
import { TransportBar } from './TransportBar.jsx';
import { SeekBar, formatTime } from './SeekBar.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { playbackStateLabel, queuePositionLabel } from './stateCopy.js';
import './NowPlaying.scss';

const MEDIA_EL_POLL_MS = 400;
const MEDIA_EL_GIVE_UP_MS = 15000;

// The Player portals into the claimed host asynchronously; poll briefly for
// its media element so the speed control can attach. Non-media renderers
// (iframes, images) never produce one — the control simply stays hidden.
function useHostMediaElement(hostRef, itemKey) {
  const [el, setEl] = useState(null);
  useEffect(() => {
    const find = () => hostRef.current?.querySelector?.('video, audio') ?? null;
    const first = find();
    setEl(first);
    if (first) return undefined;
    const poll = setInterval(() => {
      const found = find();
      if (found) { setEl(found); clearInterval(poll); }
    }, MEDIA_EL_POLL_MS);
    const giveUp = setTimeout(() => clearInterval(poll), MEDIA_EL_GIVE_UP_MS);
    return () => { clearInterval(poll); clearTimeout(giveUp); };
  }, [hostRef, itemKey]);
  return el;
}

export function NowPlayingView() {
  const { snapshot, portability } = useSessionController('local');
  const item = snapshot?.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const mediaEl = useHostMediaElement(hostRef, item?.contentId ?? null);
  const { pop } = useNav();

  // The queue entry behind the current item carries display context the slim
  // currentItem does not (containerTitle = the show/album it expanded from).
  const queueItems = snapshot?.queue?.items ?? [];
  const currentIndex = snapshot?.queue?.currentIndex ?? -1;
  const currentEntry = currentIndex >= 0 ? queueItems[currentIndex] : null;
  const containerTitle = currentEntry?.containerTitle ?? null;
  const positionLabel = queuePositionLabel(currentIndex, queueItems.length);
  // Never surface a raw content id as a metadata line.
  const metaTitle = typeof item?.title === 'string' && item.title !== item.contentId
    ? item.title
    : null;
  const durationLabel = item?.duration ? formatTime(item.duration) : null;
  const metaSubParts = [positionLabel, durationLabel].filter(Boolean);

  return (
    <div data-testid="now-playing-view" className="now-playing-view">
      <div className="now-playing-toolbar">
        <button
          type="button"
          data-testid="now-playing-back"
          className="np-back-btn"
          onClick={() => pop()}
        >
          ← Back
        </button>
        <span className="np-state" data-testid="np-state" data-state={snapshot?.state ?? ''}>
          {playbackStateLabel(snapshot?.state)}
        </span>
      </div>

      <h1
        className="now-playing-title"
        data-testid="now-playing-title"
        data-content-id={item?.contentId ?? ''}
      >
        {item ? `Now Playing: ${item.title ?? item.contentId}` : 'Nothing playing'}
      </h1>

      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />

      {item && (
        <>
          <div className="np-meta" data-testid="np-meta">
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
          </div>
          <SeekBar target="local" />
          <TransportBar target="local" mediaEl={mediaEl} />
        </>
      )}

      <QueuePanel target="local" />

      {item && (
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
