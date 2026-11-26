import { describe, it, expect } from 'vitest';
import { ShareContentSource } from './ShareContentSource.mjs';

const jobs = (job) => ({ get: (id) => (job && id === job.id ? job : null) });
const source = (job) => new ShareContentSource({ jobs: jobs(job), relativePathFor: (id) => `tmp/share/${id}.mp4` });
const job = (state) => ({ id: 's000000000001', state, provider: 'example', title: 'A video', duration: 30 });

describe('ShareContentSource', () => {
  it('answers a playable, ephemeral item while the file is still being fetched (the screen queues it first)', async () => {
    const item = await source(job('downloading')).getItem('share:s000000000001');
    expect(item.id).toBe('share:s000000000001');
    expect(item.mediaType).toBe('video');
    expect(item.mediaUrl).toBe('/api/v1/proxy/media/stream/tmp%2Fshare%2Fs000000000001.mp4');
    expect(item.metadata).toMatchObject({ ephemeral: true, shareState: 'downloading' });
    expect(await source(job('downloading')).resolvePlayables('share:s000000000001')).toHaveLength(1);
  });

  it('answers nothing for a failed or unknown job', async () => {
    expect(await source(job('failed')).getItem('share:s000000000001')).toBeNull();
    expect(await source(null).getItem('share:s000000000002')).toBeNull();
    expect(await source(null).resolvePlayables('share:s000000000002')).toEqual([]);
  });
});
