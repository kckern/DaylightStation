import getLogger from "../../../../../../../frontend/src/lib/logging/Logger.js";
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { formatFeedPlaybackTime } from '../../../players/formatTime.js';
import { getSeekMax } from '../../../players/seekRange.js';

function log() { return getLogger().child({ module: 'feed-player-section' }); }

export default function PlayerSection({ data, onPlay, activeMedia, item, playback }) {
  if (!data?.contentId) return null;

  const isPlaying = activeMedia?.item?.id === item?.id;

  if (!isPlaying) {
    return (
      <button
        onClick={() => {
          log().info('section.play', { feedItemId: item?.id, title: item?.title, contentId: data.contentId, provider: data.provider });
          onPlay?.(item, data.contentId);
        }}
        style={{
          width: '100%',
          padding: '1rem',
          background: 'var(--feed-surface-1)',
          border: '1px solid var(--feed-surface-2)',
          borderRadius: '8px',
          color: 'var(--feed-pure-white)',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        <UiIcon name="play" size={20} style={{ color: 'var(--feed-pure-white)' }} />
        Play
      </button>
    );
  }

  const { playing, currentTime, duration, toggle, seek } = playback || {};
  const seekMax = getSeekMax(duration);
  const seekValue = Math.min(Math.max(Number(currentTime) || 0, 0), seekMax);

  return (
    <div style={{
      background: 'var(--feed-surface-1)',
      borderRadius: '8px',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={toggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--feed-pure-white)',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <UiIcon name={playing ? 'pause' : 'play'} size={28} style={{ color: 'var(--feed-pure-white)' }} />
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--feed-text-3)', fontVariantNumeric: 'tabular-nums' }}>
          {formatFeedPlaybackTime(currentTime)} / {formatFeedPlaybackTime(duration)}
        </span>
        <button
          onClick={() => {
            log().info('section.stop', { feedItemId: item?.id, title: item?.title });
            onPlay?.(null);
          }}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: 'var(--feed-text-3)',
            cursor: 'pointer',
            padding: '0.25rem',
            fontSize: '0.7rem',
          }}
          aria-label="Stop"
        >
          Stop
        </button>
      </div>
      <input
        className="feed-detail-player-seek"
        type="range"
        min="0"
        max={seekMax}
        step="1"
        value={seekValue}
        disabled={seekMax === 0}
        onChange={event => seek?.(Number(event.target.value))}
        aria-label="Playback position"
        aria-valuetext={`${formatFeedPlaybackTime(currentTime)} of ${formatFeedPlaybackTime(duration)}`}
        style={{ width: '100%', accentColor: 'var(--ds-accent)', cursor: seekMax > 0 ? 'pointer' : 'not-allowed' }}
      />
    </div>
  );
}
