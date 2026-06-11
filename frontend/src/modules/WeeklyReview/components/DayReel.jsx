// frontend/src/modules/WeeklyReview/components/DayReel.jsx
import React, { useEffect, useRef } from 'react';
import FullscreenImage from './FullscreenImage.jsx';
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
    />
  );
}

export default function DayReel({ item, index, total, dayLabel, playing, muted, paused, onEnded }) {
  if (!item) {
    return (
      <div className="weekly-review-reel weekly-review-reel--empty">
        <div className="reel-empty">No photos or videos this day</div>
        <div className="reel-day-label">{dayLabel}</div>
      </div>
    );
  }

  if (item.type === 'video') {
    return (
      <div className="weekly-review-reel weekly-review-reel--video">
        {playing ? (
          <ReelVideo item={item} muted={muted} paused={paused} onEnded={onEnded} />
        ) : (
          <div className="reel-video-poster" style={{ backgroundImage: `url(${item.thumbnail})` }}>
            <div className="reel-play-hint">▶ Enter to play</div>
          </div>
        )}
        <div className="reel-overlay">
          <div className="reel-day-label">{dayLabel}</div>
          <div className="reel-index">{index + 1} / {total}</div>
          {playing && <div className="reel-mute-state">{muted ? '🔇 Enter to unmute' : '🔊'}</div>}
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
