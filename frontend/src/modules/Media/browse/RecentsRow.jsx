// frontend/src/modules/Media/browse/RecentsRow.jsx
// Horizontal strip of recently played items (local recents store). Tapping a
// tile plays it now.
import React, { useState, useEffect, useCallback } from 'react';
import { UnstyledButton, Text, Title } from '@mantine/core';
import { readRecents } from '../session/recents.js';
import { useSessionController } from '../controller/useSessionController.js';

export function RecentsRow() {
  const [recents, setRecents] = useState(() => readRecents());
  const { queue } = useSessionController('local');

  const refresh = useCallback(() => setRecents(readRecents()), []);
  useEffect(() => {
    window.addEventListener('media-recents-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('media-recents-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  if (recents.length === 0) {
    return (
      <section className="recents-row recents-row--empty">
        <Title order={2} mb="sm">Recent</Title>
        <Text c="dimmed" size="sm" data-testid="home-recents-empty" className="recents-empty-hint">
          Things you play will show up here.
        </Text>
      </section>
    );
  }

  return (
    <section data-testid="recents-row" className="recents-row">
      <Title order={2} mb="sm">Recent</Title>
      <div className="recents-scroll">
        {recents.map((r) => (
          <UnstyledButton
            key={r.contentId}
            data-testid={`recent-${r.contentId}`}
            className="recent-tile"
            onClick={() => queue.playNow?.({ contentId: r.contentId, title: r.title, format: r.format, thumbnail: r.thumbnail }, { clearRest: true })}
          >
            {r.thumbnail
              ? <img className="recent-tile-thumb" src={r.thumbnail} alt="" loading="lazy" />
              : <div className="recent-tile-thumb recent-tile-thumb--blank" aria-hidden />}
            <span className="recent-tile-title">{r.title ?? r.contentId}</span>
          </UnstyledButton>
        ))}
      </div>
    </section>
  );
}

export default RecentsRow;
