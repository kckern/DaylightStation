// frontend/src/modules/WeeklyReview/components/DayReel.jsx
import React, { useEffect, useRef } from 'react';
import FullscreenImage, { MediaCaption } from "./FullscreenImage.jsx";
import DayDataPoints from "./DayDataPoints.jsx";
import getLogger from '@/lib/logging/Logger.js';

// Lazy so the child snapshots context AFTER WeeklyReview sets app + sessionLog on
// global config at mount — otherwise these events miss the session-log routing.
let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'weekly-review-reel' }));

function ReelVideo({ item, muted, paused, onEnded }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onErr = () => logger().error('reel.video-error', { error: el.error?.message || 'unknown' });
    // `loop` means 'ended' only fires if looping is ever turned off; keep the
    // hook so a caller can still react to a real end.
    const onEnd = () => { logger().info('reel.video-ended'); onEnded?.(); };
    el.addEventListener('error', onErr);
    el.addEventListener('ended', onEnd);
    return () => { el.removeEventListener('error', onErr); el.removeEventListener('ended', onEnd); };
  }, [onEnded]);

  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (paused) el.pause();
    else {
      const p = el.play();
      if (p && p.catch) p.catch(err => logger().warn('reel.play-rejected', { error: err.message }));
    }
  }, [paused]);

  return (
    <video
      ref={ref}
      src={item.original}
      className="reel-video"
      autoPlay
      loop
      playsInline
      muted={muted}
      preload="metadata"
      poster={item.thumbnail}
    />
  );
}

export default function DayReel({ item, day, index, total, dayLabel, playing, muted, paused, onEnded }) {
  if (!item) {
    return (
      <div className="weekly-review-reel weekly-review-reel--empty">
        <div className="reel-day-label">{dayLabel}</div>
        <div className="reel-empty-data">
          <DayDataPoints day={day} />
        </div>
      </div>
    );
  }

  if (item.type === 'video') {
    return (
      <div className="weekly-review-reel weekly-review-reel--video">
        {/* Same frame as a photo: the media fills the screen (letterboxed by
            object-fit), and the caption's gradient runs the full screen width
            at the bottom. It used to hug the picture, so a portrait or small
            clip got a narrow strip of fade floating mid-screen. Clips loop
            until you move on, like a live photo. */}
        <div className="weekly-review-fullscreen-image">
          {playing ? (
            <ReelVideo item={item} muted={muted} paused={paused} onEnded={onEnded} />
          ) : (
            <>
              <img className="reel-video-poster" src={item.thumbnail} alt="" />
              <div className="reel-play-hint">▶ Enter to play</div>
            </>
          )}
          <MediaCaption item={item} index={index} total={total} dayLabel={dayLabel}>
            {playing && <div className="reel-mute-state">{muted ? '🔇 Enter to unmute' : '🔊'}</div>}
          </MediaCaption>
        </div>
      </div>
    );
  }

  return (
    <div className="weekly-review-reel weekly-review-reel--photo">
      <FullscreenImage photo={item} index={index} total={total} dayLabel={dayLabel} />
    </div>
  );
}
