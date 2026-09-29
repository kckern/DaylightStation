import { describe, expect, it } from 'vitest';
import {
  decideSourceCheck,
  isSourceRefusal,
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
