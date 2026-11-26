import { describe, it, expect, vi } from 'vitest';
import { PlaySharedVideo } from './PlaySharedVideo.mjs';
import { ShareJobs, SHARE_JOB_ID, randomShareId } from './ShareJobs.mjs';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));
const MEDIA = { size: 10, mimeType: 'video/mp4', open: () => null };

function fakeSource({ result = { kind: 'downloaded', title: 'A video', duration: 30, media: MEDIA }, ticks = [0.2, 0.6], stream = 'stream:abc', stored = null } = {}) {
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
    stored: vi.fn(async () => stored),
    cancel: vi.fn(async () => {}),
    streamContentId: vi.fn(() => stream),
  };
}

function build({ source = fakeSource(), load = vi.fn(async () => ({ ok: true })), stop = vi.fn(async () => {}), notify = vi.fn(async () => {}), stallMs = 150_000 } = {}) {
  let n = 0;
  let now = 1_000_000;
  const clock = () => now;
  const jobs = new ShareJobs({ clock, newId: () => `s${String(++n).padStart(12, '0')}` });
  const scheduled = [];
  const useCase = new PlaySharedVideo({
    jobs, sources: [source], screens: { load, stop }, notify,
    presentation: (provider) => ({ provider, logo: `/logo/${provider}`, accent: null }),
    logger: quiet(), clock, stallMs,
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  });
  return { useCase, jobs, source, load, stop, notify, scheduled, advance: (ms) => { now += ms; } };
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
    jobs.ready(job.id, { media: MEDIA });
    expect(jobs.get(job.id)).toMatchObject({ state: 'ready', progress: 1, media: MEDIA });
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
    expect(source.fetch).toHaveBeenCalledWith('abc', expect.objectContaining({ name: 's000000000001' }));
    await flush();
    expect(await useCase.status(out.jobId)).toMatchObject({ state: 'downloading', progress: 0.6, provenance: { provider: 'example' } });
    source.release();
    await flush();
    expect(await useCase.status(out.jobId)).toMatchObject({ state: 'ready', progress: 1, title: 'A video', failed: null });
    expect(await useCase.media(out.jobId)).toBe(MEDIA);
  });

  it('streams the same video when it cannot be fetched', async () => {
    const source = fakeSource({ result: { kind: 'failed', error: 'ERROR: 403', reason: 'error' } });
    const { useCase, stop, notify } = build({ source });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv', username: 'u' });
    source.release();
    await flush();
    expect(await useCase.status(jobId)).toMatchObject({ state: 'streaming', progress: 1 });
    expect(await useCase.item(jobId)).toMatchObject({ state: 'streaming', streamContentId: 'stream:abc' });
    expect(await useCase.media(jobId)).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not stream a video that is simply unavailable (private, removed)', async () => {
    const source = fakeSource({ result: { kind: 'failed', error: 'ERROR: Private video', reason: 'unavailable' } });
    const { useCase } = build({ source });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv' });
    source.release();
    await flush();
    expect(await useCase.status(jobId)).toMatchObject({ state: 'failed' });
    expect(source.streamContentId).not.toHaveBeenCalled();
  });

  it('with no stream either: fails, stops the screen after the hold, tells the sharer', async () => {
    const source = fakeSource({ result: { kind: 'failed', error: 'ERROR: unavailable', reason: 'error' }, stream: null });
    const { useCase, stop, notify, scheduled } = build({ source });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv', username: 'u' });
    source.release();
    await flush();
    expect(await useCase.status(jobId)).toMatchObject({ state: 'failed', failed: 'ERROR: unavailable' });
    expect(await useCase.item(jobId)).toBeNull();
    const stopper = scheduled.find((s) => s.ms === 8000);
    stopper.fn();
    expect(stop).toHaveBeenCalledWith('tv');
    expect(notify).toHaveBeenCalledWith('u', expect.objectContaining({ title: 'Share did not play' }));
  });

  it('gives up a fetch with no progress past the deadline, cancels it and streams instead', async () => {
    const { useCase, source, scheduled, advance } = build({ stallMs: 30_000 });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv' });
    await flush();
    advance(31_000);
    scheduled.find((s) => s.ms === 10_000).fn();
    expect(source.cancel).toHaveBeenCalledWith(jobId);
    expect(await useCase.status(jobId)).toMatchObject({ state: 'streaming' });
    // The cancelled fetch coming back later changes nothing.
    source.release();
    await flush();
    expect(await useCase.status(jobId)).toMatchObject({ state: 'streaming' });
  });

  it('on a screen that will not start: fails the job, cancels the fetch, tells the sharer', async () => {
    const load = vi.fn(async () => ({ ok: false, failedStep: 'power', error: 'TV did not wake' }));
    const { useCase, source, stop, notify } = build({ load });
    const { jobId } = useCase.accept({ url: 'https://video.example/v/1', target: 'tv', username: 'u' });
    await flush();
    expect(await useCase.status(jobId)).toMatchObject({ state: 'failed', failed: 'TV did not wake' });
    expect(source.cancel).toHaveBeenCalledWith(jobId);
    expect(stop).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('after a restart, adopts a job a source still holds', async () => {
    const source = fakeSource({ stored: { provider: 'example', title: 'Kept', duration: 9, media: MEDIA } });
    const { useCase } = build({ source });
    expect(await useCase.status('s0000000000aa')).toMatchObject({ state: 'ready', title: 'Kept', provenance: { provider: 'example' } });
    expect(await useCase.media('s0000000000aa')).toBe(MEDIA);
  });

  it('answers null for a job nobody holds', async () => {
    expect(await build().useCase.status('s999999999999')).toBeNull();
  });
});
