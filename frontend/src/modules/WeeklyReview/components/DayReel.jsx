// frontend/src/modules/WeeklyReview/components/DayReel.jsx
import React, { useEffect, useRef } from 'react';
import FullscreenImage from './FullscreenImage.jsx';
import DayDataPoints from './DayDataPoints.jsx';
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
      playsInline
      muted={muted}
      // Intrinsic dimensions arrive with metadata, and the stage sizes itself
      // from the element — so fetch them early to shorten the window where the
      // video still reports its 300x150 default and the chrome hugs that
      // instead of the picture.
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
        {/* The chrome hugs the picture, so it has to be a sibling of the media
            inside a box that IS the picture. Pinning the overlay to the reel
            instead left it aligned to the letterbox whenever the video's aspect
            ratio differed from the screen's. The stage shrink-wraps whatever it
            holds, and the media sizes intrinsically under a 100% cap, so the
            two always agree. (Photos deliberately do the opposite — see
            .fullscreen-image-overlay, whose gradient bleeds to the screen edge.) */}
        <div className="reel-stage">
          {playing ? (
            <ReelVideo item={item} muted={muted} paused={paused} onEnded={onEnded} />
          ) : (
            <>
              <img className="reel-video-poster" src={item.thumbnail} alt="" />
              <div className="reel-play-hint">▶ Enter to play</div>
            </>
          )}
          <div className="reel-overlay">
            <div className="reel-day-label">{dayLabel}</div>
            <div className="reel-index">{index + 1} / {total}</div>
            {playing && <div className="reel-mute-state">{muted ? '🔇 Enter to unmute' : '🔊'}</div>}
          </div>
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
