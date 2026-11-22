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
          background: '#1a1b1e',
          border: '1px solid #25262b',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}
      >
        <UiIcon name="play" size={20} style={{ color: '#fff' }} />
        Play
      </button>
    );
  }

  const { playing, currentTime, duration, toggle, seek } = playback || {};
  const seekMax = getSeekMax(duration);
  const seekValue = Math.min(Math.max(Number(currentTime) || 0, 0), seekMax);

  return (
    <div style={{
      background: '#1a1b1e',
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
            color: '#fff',
            cursor: 'pointer',
            padding: '0.25rem',
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <UiIcon name={playing ? 'pause' : 'play'} size={28} style={{ color: '#fff' }} />
        </button>
        <span style={{ fontSize: '0.75rem', color: '#868e96', fontVariantNumeric: 'tabular-nums' }}>
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
            color: '#868e96',
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
        style={{ width: '100%', accentColor: '#228be6', cursor: seekMax > 0 ? 'pointer' : 'not-allowed' }}
      />
    </div>
  );
}
