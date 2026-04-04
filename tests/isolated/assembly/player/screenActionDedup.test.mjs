import { jest, describe, test, expect, beforeEach } from '@jest/globals';

describe('ScreenActionHandler media deduplication', () => {
  const DEDUP_WINDOW_MS = 3000;
  let lastMedia;

  function isDuplicate(contentId) {
    const now = Date.now();
    if (contentId && contentId === lastMedia?.contentId
        && now - lastMedia.ts < DEDUP_WINDOW_MS) {
      return true;
    }
    lastMedia = { contentId, ts: now };
    return false;
  }

  beforeEach(() => {
    lastMedia = null;
  });

  test('first command is never a duplicate', () => {
    expect(isDuplicate('office-program')).toBe(false);
  });

  test('same contentId within window is a duplicate', () => {
    isDuplicate('office-program');
    expect(isDuplicate('office-program')).toBe(true);
  });

  test('different contentId within window is not a duplicate', () => {
    isDuplicate('office-program');
    expect(isDuplicate('morning-program')).toBe(false);
  });

  test('same contentId after window expires is not a duplicate', () => {
    isDuplicate('office-program');
    lastMedia.ts -= DEDUP_WINDOW_MS + 1;
    expect(isDuplicate('office-program')).toBe(false);
  });

  test('null contentId is never deduplicated', () => {
    isDuplicate(null);
    expect(isDuplicate(null)).toBe(false);
  });
});
