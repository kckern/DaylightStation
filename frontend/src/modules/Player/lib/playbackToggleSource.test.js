import { describe, it, expect } from 'vitest';
import {
  tagPauseSource,
  tagPlaySource,
  readAndClearPauseSource,
  readAndClearPlaySource
} from './playbackToggleSource.js';

describe('playbackToggleSource helpers', () => {
  it('writes and reads pause source from the media element', () => {
    const el = {};
    tagPauseSource(el, 'recovery-nudge');
    expect(readAndClearPauseSource(el)).toBe('recovery-nudge');
  });

  it('writes and reads play source from the media element', () => {
    const el = {};
    tagPlaySource(el, 'user-keyboard');
    expect(readAndClearPlaySource(el)).toBe('user-keyboard');
  });

  it('returns "dom-event" when no source has been tagged', () => {
    const el = {};
    expect(readAndClearPauseSource(el)).toBe('dom-event');
    expect(readAndClearPlaySource(el)).toBe('dom-event');
  });

  it('clears the tag after read so the next event sees default', () => {
    const el = {};
    tagPauseSource(el, 'controller');
    expect(readAndClearPauseSource(el)).toBe('controller');
    expect(readAndClearPauseSource(el)).toBe('dom-event');
  });

  it('does not throw on null/undefined element', () => {
    expect(() => tagPauseSource(null, 'x')).not.toThrow();
    expect(() => tagPauseSource(undefined, 'x')).not.toThrow();
    expect(readAndClearPauseSource(null)).toBe('dom-event');
    expect(readAndClearPauseSource(undefined)).toBe('dom-event');
  });

  it('coerces non-string source to string', () => {
    const el = {};
    tagPauseSource(el, 42);
    expect(readAndClearPauseSource(el)).toBe('42');
  });

  it('ignores empty string and falls back to default', () => {
    const el = {};
    tagPauseSource(el, '');
    expect(readAndClearPauseSource(el)).toBe('dom-event');
  });

  it('pause and play sources are independent', () => {
    const el = {};
    tagPauseSource(el, 'P');
    tagPlaySource(el, 'Q');
    expect(readAndClearPauseSource(el)).toBe('P');
    expect(readAndClearPlaySource(el)).toBe('Q');
  });
});
