import React, { useEffect, useMemo, useState } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { AppModal } from '@/modules/Fitness/shared/composites';
import getLogger from '@/lib/logging/Logger.js';
import './FitnessPlaylistSelector.scss';

/** "4h 3m", "45m", or null when the length is unknown. */
export function formatPlaylistLength(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return null;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "68 tracks · 4h 3m" from whatever the backend could enrich; null if nothing. */
export function formatPlaylistMeta({ trackCount, durationSeconds } = {}) {
  const parts = [];
  const count = Number(trackCount);
  if (Number.isFinite(count) && count > 0) parts.push(`${count} ${count === 1 ? 'track' : 'tracks'}`);
  const length = formatPlaylistLength(durationSeconds);
  if (length) parts.push(length);
  return parts.length ? parts.join(' · ') : null;
}

const PlaylistCover = ({ item }) => {
  const [failed, setFailed] = useState(false);
  if (item.thumb && !failed) {
    return <img src={DaylightMediaPath(item.thumb)} alt="" onError={() => setFailed(true)} />;
  }
  return <span className="playlist-picker__placeholder" aria-hidden="true">{item.isNoMusic ? '🔇' : '🎵'}</span>;
};

/**
 * Full-screen-ish picker for the fitness music playlists. Every configured
 * playlist (plus "No Music") is on one page — tap a cover to switch and close.
 */
const FitnessPlaylistSelector = ({ playlists, selectedPlaylistId, onSelect, onClose, isOpen }) => {
  const logger = useMemo(() => getLogger().child({ component: 'playlist-picker' }), []);

  const items = useMemo(() => [
    { id: null, name: 'No Music', isNoMusic: true, meta: 'Turn music off' },
    ...(playlists || []).map((p) => ({
      id: p.id,
      name: p.name,
      thumb: p.thumb || p.composite || p.art,
      meta: formatPlaylistMeta(p),
    })),
  ], [playlists]);

  useEffect(() => {
    if (!isOpen) return;
    logger.info('playlist-picker.open', { selectedPlaylistId: selectedPlaylistId ?? null, count: items.length - 1 });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id) => {
    if (id === selectedPlaylistId) {
      logger.info('playlist-picker.reselect', { playlistId: id ?? null });
      onClose?.();
      return;
    }
    logger.info('playlist-picker.select', { from: selectedPlaylistId ?? null, to: id ?? null });
    onSelect?.(id);
    onClose?.();
  };

  const handleDismiss = () => {
    logger.info('playlist-picker.dismiss', { selectedPlaylistId: selectedPlaylistId ?? null });
    onClose?.();
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={handleDismiss}
      title="Choose Music"
      size="xl"
      className="playlist-picker"
    >
      <div className="playlist-picker__grid" role="listbox" aria-label="Playlists">
        {items.map((item) => {
          const isSelected = item.id === selectedPlaylistId;
          return (
            <button
              type="button"
              key={item.id ?? 'no-music'}
              role="option"
              aria-selected={isSelected}
              className={`playlist-picker__tile${isSelected ? ' is-selected' : ''}${item.isNoMusic ? ' is-no-music' : ''}`}
              onClick={() => handleSelect(item.id)}
            >
              <span className="playlist-picker__cover">
                <PlaylistCover item={item} />
                {isSelected && <span className="playlist-picker__check" aria-hidden="true">✓</span>}
              </span>
              <span className="playlist-picker__name">{item.name}</span>
              {item.meta && <span className="playlist-picker__meta">{item.meta}</span>}
            </button>
          );
        })}
      </div>
    </AppModal>
  );
};

export default FitnessPlaylistSelector;
