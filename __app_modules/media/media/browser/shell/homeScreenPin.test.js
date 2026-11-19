import { describe, it, expect } from 'vitest';
import {
  PIN_LABEL_MAX, pinLabel, isPinnableContentId, pinTarget, pinOutcomeMessage,
} from './homeScreenPin.js';

const codePoints = (s) => [...s].length;

describe('pinLabel', () => {
  it('trims and keeps a plain title', () => {
    expect(pinLabel('  Road trip  ')).toBe('Road trip');
  });

  it('strips bidi overrides, isolates and direction marks', () => {
    expect(pinLabel('‮evilTitle‬')).toBe('evilTitle');
    expect(pinLabel('A⁦B⁩‎C‏')).toBe('ABC');
  });

  it('strips zero-width and other format characters', () => {
    expect(pinLabel('Zero​width‍﻿')).toBe('Zerowidth');
  });

  it('turns control characters and line separators into single spaces', () => {
    expect(pinLabel('Line\none\tand two three\u0007')).toBe('Line one and two three');
  });

  it('strips private-use characters', () => {
    expect(pinLabel('Icon name')).toBe('Icon name');
  });

  it('cuts to 40 code points', () => {
    const label = pinLabel('x'.repeat(60));
    expect(codePoints(label)).toBe(PIN_LABEL_MAX);
    expect(PIN_LABEL_MAX).toBe(40);
  });

  it('never splits a grapheme at the cut', () => {
    // 39 letters, then a thumbs-up with a skin tone (two code points): keeping
    // the whole emoji would make 41, so it is dropped rather than split.
    const label = pinLabel(`${'a'.repeat(39)}\u{1F44D}\u{1F3FD}tail`);
    expect(label).toBe('a'.repeat(39));
    // A combining accent stays with its letter.
    const accented = pinLabel(`${'b'.repeat(39)}ézz`);
    expect(accented).toBe('b'.repeat(39));
  });

  it('counts code points, so astral characters fit on their own', () => {
    const label = pinLabel('\u{1F3B5}'.repeat(50));
    expect(codePoints(label)).toBe(40);
  });

  it('trims again after the cut', () => {
    expect(pinLabel(`${'a'.repeat(39)} bcd`)).toBe('a'.repeat(39));
  });

  it('answers an empty string for nothing usable', () => {
    expect(pinLabel('‮​  ')).toBe('');
    expect(pinLabel(null)).toBe('');
    expect(pinLabel(42)).toBe('');
  });
});

describe('isPinnableContentId', () => {
  it.each([
    'plex:4242', 'singalong:primary/5', 'files:music/Album One/01.mp3', 'list:menu-1',
  ])('accepts %s', (id) => {
    expect(isPinnableContentId(id)).toBe(true);
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['no source', ':abc'],
    ['no local id', 'plex:'],
    ['no colon', 'plex4242'],
    ['a URL', 'https://example.org/x'],
    ['a URL scheme as source', 'javascript:alert(1)'],
    ['an intent', 'intent:#Intent;end'],
    ['a dot-dot segment', 'files:music/../secret'],
    ['a dot segment', 'files:music/./x'],
    ['an empty segment', 'files:music//x'],
    ['a backslash', 'files:music\\x'],
    ['a bar', 'plex:1|2'],
    ['a control character', 'plex:1\n2'],
    ['a shuffle modifier', 'plex:4242/shuffle'],
    ['a playable modifier', 'plex:4242/playable'],
    ['a launchable modifier', 'plex:4242/launchable'],
    ['a recent_on_top modifier', 'plex:4242/recent_on_top'],
    ['an expand modifier', 'plex:4242/expand'],
    ['too long', `plex:${'1'.repeat(400)}`],
  ])('refuses %s', (_why, id) => {
    expect(isPinnableContentId(id)).toBe(false);
  });
});

describe('pinTarget', () => {
  const item = { contentId: 'plex:11', title: 'Track eleven' };

  it('prefers the container the item was played from', () => {
    expect(pinTarget(item, { containerContentId: 'plex:900', containerTitle: 'Road trip' }))
      .toEqual({ contentId: 'plex:900', label: 'Road trip', kind: 'container' });
  });

  it('reads the container from the current item when the queue entry has none', () => {
    expect(pinTarget({ ...item, containerContentId: 'plex:900', containerTitle: 'Mix' }, null))
      .toEqual({ contentId: 'plex:900', label: 'Mix', kind: 'container' });
  });

  it('falls back to the item when nothing contains it', () => {
    expect(pinTarget(item, {})).toEqual({ contentId: 'plex:11', label: 'Track eleven', kind: 'item' });
  });

  it('falls back to the item when the container id is not pinnable', () => {
    expect(pinTarget(item, { containerContentId: 'plex:900/shuffle', containerTitle: 'Mix' }))
      .toEqual({ contentId: 'plex:11', label: 'Track eleven', kind: 'item' });
  });

  it('names a container with no title after the item', () => {
    expect(pinTarget(item, { containerContentId: 'plex:900' }))
      .toEqual({ contentId: 'plex:900', label: 'Track eleven', kind: 'container' });
  });

  it('sanitizes the label it sends', () => {
    expect(pinTarget({ contentId: 'plex:1', title: '‮Mix‬\n' }, null).label).toBe('Mix');
  });

  it('is null when nothing can be pinned', () => {
    expect(pinTarget(null, null)).toBeNull();
    expect(pinTarget({ contentId: 'https://x/y', title: 'Web' }, null)).toBeNull();
    expect(pinTarget({ contentId: 'plex:1', title: '​' }, null)).toBeNull();
  });

  it('never uses a raw id as the label', () => {
    expect(pinTarget({ contentId: 'plex:1', title: 'plex:1' }, null)).toBeNull();
  });
});

describe('pinOutcomeMessage', () => {
  it('asks the owner to confirm on an accepted request, never claims it was added', () => {
    const msg = pinOutcomeMessage({ accepted: true });
    expect(msg).toBe("Confirm on your phone's dialog");
    expect(msg).not.toMatch(/added/i);
  });

  it('asks for a moment when rate limited', () => {
    expect(pinOutcomeMessage({ accepted: false, reason: 'rate_limited' })).toBe('One moment, then try again');
  });

  it('names a launcher that cannot pin', () => {
    expect(pinOutcomeMessage({ accepted: false, reason: 'launcher_cannot_pin' }))
      .toBe("This phone's home screen can't add shortcuts");
  });

  it('names the limit on pinned shortcuts', () => {
    expect(pinOutcomeMessage({ accepted: false, reason: 'limit_reached' }))
      .toBe('Too many home screen shortcuts; remove one first');
  });

  it.each([
    'refused', 'not_top_frame', 'bad_request', 'invalid_content_id', 'invalid_label',
    'not_available', 'launcher_refused', 'failed', 'something_new', undefined,
  ])('says it could not add for %s', (reason) => {
    expect(pinOutcomeMessage({ accepted: false, reason })).toBe("Couldn't add to home screen");
  });
});
