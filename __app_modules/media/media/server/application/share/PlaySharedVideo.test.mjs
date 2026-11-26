import { describe, it, expect, vi } from 'vitest';
import { PlaySharedVideo } from './PlaySharedVideo.mjs';
import { ShareJobs, SHARE_JOB_ID, randomShareId } from './ShareJobs.mjs';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSource({ result = { kind: 'downloaded', filePath: '/t/x.mp4', title: 'A video', duration: 30 }, ticks = [0.2, 0.6] } = {}) {
  let release;
  const gate = new Promise((r) => { release = r; });
  return {
    release: () => release(),
    recognize: vi.fn((url) => (url.includes('video.example') ? { provider: 'example', sourceId: 'abc' } : null)),
    fetch: vi.fn(async (_id, { onProgress }) => {
      ticks.forEach((t) => onProgress(t));
      await gate;
      return result;
    }),
  };
}

function build({ source = fakeSource(), load = vi.fn(async () => ({ ok: true })), stop = vi.fn(async () => {}), notify = vi.fn(async () => {}) } = {}) {
  let n = 0;
  const jobs = new ShareJobs({ newId: () => `s${String(++n).padStart(12, '0')}` });
  const scheduled = [];
  const useCase = new PlaySharedVideo({
    jobs, sources: [source], screens: { load, stop }, notify,
    filePathFor: (id) => `/t/${id}.mp4`,
    presentation: (provider) => ({ provider, logo: `/logo/${provider}`, accent: null }),
    logger: quiet(),
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });
  return { useCase, jobs, source, load, stop, notify, scheduled };
}

describe('ShareJobs', () => {
  it('makes ids the content source and routes accept', () => {
    expect(randomShareId()).toMatch(SHARE_JOB_ID);
  });

  it('only moves progress forward and below 1 until ready', () => {
    const jobs = new ShareJobs({ newId: () => 's000000000001' });
    const job = jobs.create({ provider: 'p', sourceId: 'x', target: 'tv' });
    jobs.progress(job.id, 0.5);
    jobs.progress(job.id, 0.3);
    jobs.progress(job.id, 5);
    expect(jobs.get(job.id).progress).toBe(0.99);
    jobs.ready(job.id, { filePath: '/x.mp4' });
    expect(jobs.get(job.id)).toMatchObject({ state: 'ready', progress: 1 });
  });
});

describe('PlaySharedVideo', () => {
  it('recognises links through its sources only', () => {
    const { useCase } = build();
    expect(useCase.matches('https://video.example/v/1')).toBe(true);
    expect(useCase.matches('https://other.example/')).toBe(false);
  });

  it('plays share:<job> on the target at once and reports real progress until ready', async () => {
    const { useCase, source, load } = build();
    const out = useCase.accept({ url: 'https://video.example/v/1', target: 'livingroom-tv', username: 'u' });
    expect(out).toEqual({ kind: 'video', provider: 'example', jobId: 's000000000001', target: 'livingroom-tv' });
    expect(load).toHaveBeenCalledWith('livingroom-tv', { play: 'share:s000000000001' });
    expect(source.fetch).toHaveBeenCalledWith('abc', expect.objectContaining({ outputPath: '/t/s000000000001.mp4' }));
    await flush();
    expect(useCase.status(out.jobId)).toMatchObject({ state: 'downloading', progress: 0.6, provenance: { provider: 'example' } });
    source.release();
    await flush();
    expect(useCase.status(out.jobId)).toMatchObject({ state: 'ready', progress: 1, title: 'A video', failed: null });
  });

  it('on a failed fetch: marks it failed, stops the screen after the hold, tells the sharer', async () => {
    const source = fakeSource({ result: { kind: 'failed', error: 'ERROR: unavailable' } });
    const { useCase, stop, notify, scheduled } = build({ source });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv', username: 'u' });
    source.release();
    await flush();
    expect(useCase.status(jobId)).toMatchObject({ state: 'failed', failed: 'ERROR: unavailable' });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(8000);
    scheduled[0].fn();
    expect(stop).toHaveBeenCalledWith('tv');
    expect(notify).toHaveBeenCalledWith('u', expect.objectContaining({ title: 'Share did not play' }));
  });

  it('on a screen that will not start: fails the job and tells the sharer, no stop', async () => {
    const load = vi.fn(async () => ({ ok: false, failedStep: 'power', error: 'TV did not wake' }));
    const { useCase, stop, notify, scheduled } = build({ load });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv', username: 'u' });
    await flush();
    expect(useCase.status(jobId)).toMatchObject({ state: 'failed', failed: 'TV did not wake' });
    expect(scheduled).toHaveLength(0);
    expect(stop).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('answers null for an unknown job', () => {
    expect(build().useCase.status('s999999999999')).toBeNull();
  });
});
