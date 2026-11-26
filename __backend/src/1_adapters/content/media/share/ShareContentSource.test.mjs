import { describe, it, expect } from 'vitest';
import { ShareContentSource } from './ShareContentSource.mjs';

const handler = (job) => ({ item: async (id) => (job && id === job.id ? job : null) });
const job = (state, extra = {}) => ({ id: 's000000000001', state, provider: 'example', title: 'A video', duration: 30, streamContentId: null, ...extra });
const source = (j, resolveItem) => new ShareContentSource({ jobs: handler(j), resolveItem, logger: { warn() {} } });

describe('ShareContentSource', () => {
  it('answers a playable, ephemeral item while the video is still being fetched (the screen queues it first)', async () => {
    const item = await source(job('downloading')).getItem('share:s000000000001');
    expect(item.id).toBe('share:s000000000001');
    expect(item.mediaType).toBe('video');
    expect(item.mediaUrl).toBe('/api/v1/share/jobs/s000000000001/media');
    expect(item.metadata).toMatchObject({ ephemeral: true, shareState: 'downloading' });
    expect(await source(job('downloading')).resolvePlayables('share:s000000000001')).toHaveLength(1);
  });

  it('a streaming share plays the stream item, under the share id', async () => {
    const stream = { title: 'From the stream', mediaType: 'video', mediaUrl: { kind: 'stream-proxy', sourceUrl: 'x' }, duration: 31, metadata: { contentFormat: 'video' } };
    const item = await source(job('streaming', { streamContentId: 'stream:abc' }), async (cid) => (cid === 'stream:abc' ? stream : null)).getItem('share:s000000000001');
    expect(item.id).toBe('share:s000000000001');
    expect(item.mediaUrl).toEqual({ kind: 'stream-proxy', sourceUrl: 'x' });
    expect(item.metadata).toMatchObject({ ephemeral: true, streamedFrom: 'stream:abc' });
  });

  it('answers nothing for an unknown job, or a stream that will not resolve', async () => {
    expect(await source(null).getItem('share:s000000000002')).toBeNull();
    expect(await source(job('streaming', { streamContentId: 'stream:abc' }), async () => null).getItem('share:s000000000001')).toBeNull();
    expect(await source(null).resolvePlayables('share:s000000000002')).toEqual([]);
  });
});
