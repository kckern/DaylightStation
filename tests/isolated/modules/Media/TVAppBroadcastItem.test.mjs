import { describe, it, expect } from 'vitest';

function deriveTVBroadcastItem(currentContent) {
  if (!currentContent) return null;
  if (currentContent.type !== 'player' && currentContent.type !== 'composite') return null;
  const props = currentContent.props || {};
  const item = props.play || (props.queue && props.queue[0]) || null;
  if (!item) return null;
  return {
    contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
    title: item.title ?? item.label ?? item.name ?? null,
    format: item.format ?? item.mediaType ?? item.type ?? null,
    thumbnail: item.thumbnail ?? item.image ?? null,
  };
}

describe('TVApp broadcastItem derivation', () => {
  it('returns null when currentContent is null', () => {
    expect(deriveTVBroadcastItem(null)).toBeNull();
  });

  it('returns null for non-player content types', () => {
    expect(deriveTVBroadcastItem({ type: 'menu', props: {} })).toBeNull();
    expect(deriveTVBroadcastItem({ type: 'display', props: {} })).toBeNull();
    expect(deriveTVBroadcastItem({ type: 'app', props: {} })).toBeNull();
  });

  it('extracts item for player type', () => {
    const result = deriveTVBroadcastItem({
      type: 'player',
      props: { play: { contentId: 'plex:999', title: 'Movie', format: 'video' } },
    });
    expect(result).toEqual({ contentId: 'plex:999', title: 'Movie', format: 'video', thumbnail: null });
  });

  it('extracts item for composite type', () => {
    const result = deriveTVBroadcastItem({
      type: 'composite',
      props: { play: { contentId: 'plex:888', title: 'Show' } },
    });
    expect(result?.contentId).toBe('plex:888');
  });

  it('returns null when play prop missing', () => {
    expect(deriveTVBroadcastItem({ type: 'player', props: {} })).toBeNull();
  });
});
