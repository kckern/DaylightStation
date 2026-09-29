import { describe, expect, it } from 'vitest';
import {
  decideSourceCheck,
  isSourceRefusal,
  isSuspectedRefusal,
  sourceNoticeText,
  sourcePollDelayMs,
  toHealableContentId,
  SOURCE_POLL_MAX_DELAY_MS,
} from './sourceAvailability.js';

describe('isSourceRefusal', () => {
  it('recognises the 2026-09-28 error exactly as the element reported it', () => {
    expect(isSourceRefusal({ errorCode: 4, errorMessage: '404: Not Found' })).toBe(true);
  });

  it('recognises the proxy 503 and a network-coded refusal', () => {
    expect(isSourceRefusal({ errorCode: 4, errorMessage: '503: Service Unavailable' })).toBe(true);
    expect(isSourceRefusal({ errorCode: 2, errorMessage: '403: Forbidden' })).toBe(true);
  });

  it('ignores decode errors, aborts and unrelated failures', () => {
    expect(isSourceRefusal({ errorCode: 3, errorMessage: '404: Not Found' })).toBe(false);
    expect(isSourceRefusal({ errorCode: 1, errorMessage: '' })).toBe(false);
    expect(isSourceRefusal({ errorCode: 4, errorMessage: 'MEDIA_ELEMENT_ERROR: Format error' })).toBe(false);
    expect(isSourceRefusal({ errorCode: 2, errorMessage: 'PIPELINE_ERROR_READ' })).toBe(false);
    expect(isSourceRefusal({})).toBe(false);
  });
});

// 2026-09-29: Plex refused a Bluey part mid-episode. Chromium reported it as
// "Format error" (after a URL refresh) and "PipelineStatus::PIPELINE_ERROR_READ"
// (after a remount) — no status prefix — so it never read as a refusal and the
// stall ladder skipped the episode at 90%.
describe('isSuspectedRefusal', () => {
  it('suspects the mid-playback errors that carry no HTTP status', () => {
    expect(isSuspectedRefusal({ errorCode: 4, errorMessage: 'MEDIA_ELEMENT_ERROR: Format error' })).toBe(true);
    expect(isSuspectedRefusal({ errorCode: 2, errorMessage: 'PipelineStatus::PIPELINE_ERROR_READ: FFmpegDemuxer: data source error' })).toBe(true);
    expect(isSuspectedRefusal({ errorCode: 4, errorMessage: null })).toBe(true);
  });

  it('is not a suspicion when the refusal is already definite, or the code cannot be one', () => {
    expect(isSuspectedRefusal({ errorCode: 4, errorMessage: '404: Not Found' })).toBe(false);
    expect(isSuspectedRefusal({ errorCode: 3, errorMessage: 'PIPELINE_ERROR_DECODE' })).toBe(false);
    expect(isSuspectedRefusal({ errorCode: null, errorMessage: 'Format error' })).toBe(false);
  });
});

describe('toHealableContentId', () => {
  it('normalises Plex ids and refuses everything else', () => {
    expect(toHealableContentId('plex:696316')).toBe('plex:696316');
    expect(toHealableContentId('696316')).toBe('plex:696316');
    expect(toHealableContentId(null, 696316)).toBe('plex:696316');
    expect(toHealableContentId('immich:abc')).toBeNull();
    expect(toHealableContentId(null)).toBeNull();
  });
});

describe('sourcePollDelayMs', () => {
  it('backs off 2s, 4s, 8s, then holds at 15s', () => {
    expect([0, 1, 2, 3, 10].map(sourcePollDelayMs)).toEqual([2000, 4000, 8000, SOURCE_POLL_MAX_DELAY_MS, SOURCE_POLL_MAX_DELAY_MS]);
  });
});

describe('decideSourceCheck', () => {
  it('waits on unreadable whether or not it was already waiting', () => {
    expect(decideSourceCheck({ state: 'unreadable', waiting: false })).toBe('wait');
    expect(decideSourceCheck({ state: 'unreadable', waiting: true })).toBe('wait');
  });

  it('resumes after a wait, retries after a transient refusal', () => {
    expect(decideSourceCheck({ state: 'readable', waiting: true })).toBe('resume');
    expect(decideSourceCheck({ state: 'readable', waiting: false })).toBe('retry');
  });

  it('a merely suspected refusal that turns out readable goes back to the ladder, not to an extra reload', () => {
    // A readable file with a failing stream is a stall, not a refusal; reloading
    // outside the ladder on every such error would loop past its budget.
    expect(decideSourceCheck({ state: 'readable', waiting: false, suspected: true })).toBe('normal');
    expect(decideSourceCheck({ state: 'unreadable', waiting: false, suspected: true })).toBe('wait');
    expect(decideSourceCheck({ state: 'readable', waiting: true, suspected: true })).toBe('resume');
  });

  it('hands a missing file back to the normal ladder even mid-wait', () => {
    expect(decideSourceCheck({ state: 'missing', waiting: true })).toBe('normal');
  });

  it('keeps waiting through an unknown or failed check, but never starts a wait on one', () => {
    expect(decideSourceCheck({ state: 'unknown', waiting: true })).toBe('wait');
    expect(decideSourceCheck({ state: null, waiting: true })).toBe('wait');
    expect(decideSourceCheck({ state: 'unknown', waiting: false })).toBe('normal');
    expect(decideSourceCheck({ state: null, waiting: false })).toBe('normal');
  });
});

describe('sourceNoticeText', () => {
  it('says what is wrong and how long it has been', () => {
    expect(sourceNoticeText({ mediaType: 'video', unavailableMs: 125_400 })).toBe('Video file unavailable — retrying · 2:05');
    expect(sourceNoticeText({ mediaType: 'audio', unavailableMs: 0 })).toBe('Audio file unavailable — retrying · 0:00');
  });
});
