import { describe, it, expect } from 'vitest';

// Pure function mirroring the broadcastItem derivation in OfficeApp
// Tests guard the correctness of the logic before wiring into the component
function deriveBroadcastItem(currentContent) {
  const playerTypes = new Set(['play', 'queue', 'playlist']);
  if (!currentContent || !playerTypes.has(currentContent.type)) return null;
  const props = currentContent.props || {};
  const item = props.play || (props.queue && props.queue[0]) || (props.playlist && props.playlist[0]) || null;
  if (!item) return null;
  return {
    contentId: item.contentId ?? item.plex ?? item.assetId ?? null,
    title: item.title ?? item.label ?? item.name ?? null,
    format: item.format ?? item.mediaType ?? item.type ?? null,
    thumbnail: item.thumbnail ?? item.image ?? null,
  };
}

describe('OfficeApp broadcastItem derivation', () => {
  it('returns null when currentContent is null', () => {
    expect(deriveBroadcastItem(null)).toBeNull();
  });

  it('returns null for non-player content types', () => {
    expect(deriveBroadcastItem({ type: 'list', props: {} })).toBeNull();
    expect(deriveBroadcastItem({ type: 'menu', props: {} })).toBeNull();
    expect(deriveBroadcastItem({ type: 'open', props: {} })).toBeNull();
  });

  it('extracts contentId/title/format from play type', () => {
    const result = deriveBroadcastItem({
      type: 'play',
      props: { play: { contentId: 'plex:123', title: 'Song', format: 'audio' } },
    });
    expect(result).toEqual({ contentId: 'plex:123', title: 'Song', format: 'audio', thumbnail: null });
  });

  it('extracts from first item in queue type', () => {
    const result = deriveBroadcastItem({
      type: 'queue',
      props: { queue: [{ contentId: 'plex:456', title: 'Episode', format: 'video', thumbnail: 'img.jpg' }] },
    });
    expect(result?.contentId).toBe('plex:456');
    expect(result?.thumbnail).toBe('img.jpg');
  });

  it('returns null when play prop is missing from play type', () => {
    expect(deriveBroadcastItem({ type: 'play', props: {} })).toBeNull();
  });

  it('extracts from first item in playlist type', () => {
    const result = deriveBroadcastItem({
      type: 'playlist',
      props: { playlist: [{ contentId: 'plex:789', title: 'Track', format: 'audio' }] },
    });
    expect(result?.contentId).toBe('plex:789');
    expect(result?.format).toBe('audio');
  });
});
