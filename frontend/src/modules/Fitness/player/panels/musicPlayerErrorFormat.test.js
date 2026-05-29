import { describe, it, expect } from 'vitest';
import { formatMusicErrorMessage, isRecoverableMusicError } from './musicPlayerErrorFormat.js';

describe('formatMusicErrorMessage', () => {
  it('returns null for falsy input', () => { expect(formatMusicErrorMessage(null)).toBeNull(); });
  it('formats fetch-failed with HTTP status', () => {
    expect(formatMusicErrorMessage({ kind: 'fetch-failed', httpStatus: '502' })).toBe('Music API error (HTTP 502)');
  });
  it('formats fetch-failed without HTTP status', () => {
    expect(formatMusicErrorMessage({ kind: 'fetch-failed' })).toBe('Music API error');
  });
  it('formats fetch-timeout', () => {
    expect(formatMusicErrorMessage({ kind: 'fetch-timeout' })).toBe('Music load timed out');
  });
  it('formats empty-queue', () => {
    expect(formatMusicErrorMessage({ kind: 'empty-queue' })).toBe('Playlist empty');
  });
  it('formats invalid-queue', () => {
    expect(formatMusicErrorMessage({ kind: 'invalid-queue' })).toBe('Playlist contains no playable items');
  });
  it('formats media-error with code', () => {
    expect(formatMusicErrorMessage({ kind: 'media-error', code: 4 })).toBe('Media error (code 4)');
  });
  it('formats media-error without code', () => {
    expect(formatMusicErrorMessage({ kind: 'media-error' })).toBe('Media error');
  });
  it('formats media-load-timeout', () => {
    expect(formatMusicErrorMessage({ kind: 'media-load-timeout' })).toBe('Music load timed out');
  });
  it('returns generic fallback for unknown kind', () => {
    expect(formatMusicErrorMessage({ kind: 'something-new' })).toBe('Music unavailable');
  });
});

describe('isRecoverableMusicError', () => {
  it('treats transient queue-fetch failures as recoverable', () => {
    expect(isRecoverableMusicError('fetch-failed')).toBe(true);
    expect(isRecoverableMusicError('fetch-timeout')).toBe(true);
  });
  it('treats genuine content problems as non-recoverable', () => {
    expect(isRecoverableMusicError('empty-queue')).toBe(false);
    expect(isRecoverableMusicError('invalid-queue')).toBe(false);
  });
  it('returns false for null/unknown kinds', () => {
    expect(isRecoverableMusicError(null)).toBe(false);
    expect(isRecoverableMusicError('something-new')).toBe(false);
  });
});
