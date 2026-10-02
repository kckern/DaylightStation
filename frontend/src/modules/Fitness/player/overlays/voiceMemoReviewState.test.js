import { describe, it, expect, vi } from 'vitest';
import { buildReviewOverlayState, isOverlayMemoMissing } from './voiceMemoReviewState.js';
import { resolveCurrentMemo } from './resolveCurrentMemo.js';

const retroMemo = { memoId: 'vm_giQ5Buu6APEhBmED', transcriptClean: 'Pairs of 40s and 30s', retroactive: true };

describe('buildReviewOverlayState', () => {
  it('keeps the inline memo even when the backend minted an id (retroactive)', () => {
    const state = buildReviewOverlayState({ memoOrId: retroMemo, autoAccept: false, now: 1 });
    expect(state.memoId).toBe(retroMemo.memoId);
    expect(state.memo).toBe(retroMemo);
  });

  it('carries the historical sessionId and onComplete across the capture → review hand-off', () => {
    const onComplete = vi.fn();
    const state = buildReviewOverlayState({
      memoOrId: retroMemo, autoAccept: false, carry: { sessionId: '20261002141038', onComplete }, now: 1,
    });
    expect(state.sessionId).toBe('20261002141038');
    expect(state.onComplete).toBe(onComplete);
  });

  it('opening by id alone stores no inline memo', () => {
    const state = buildReviewOverlayState({ memoOrId: 'vm_1', autoAccept: true, now: 1 });
    expect(state.memo).toBeNull();
    expect(state.sessionId).toBeNull();
  });
});

describe('isOverlayMemoMissing', () => {
  it('does NOT clear a retroactive memo that is absent from the live list (the stuck-review bug)', () => {
    const state = buildReviewOverlayState({ memoOrId: retroMemo, autoAccept: false, now: 1 });
    expect(isOverlayMemoMissing(state, [])).toBe(false);
    expect(resolveCurrentMemo(state, [])).toBe(retroMemo);
  });

  it('clears an id-only target that is in neither the list nor inline', () => {
    const state = buildReviewOverlayState({ memoOrId: 'vm_gone', autoAccept: false, now: 1 });
    expect(isOverlayMemoMissing(state, [{ memoId: 'vm_other' }])).toBe(true);
  });

  it('is not missing when the live list has it, and the live copy wins', () => {
    const live = { memoId: 'vm_1', transcriptClean: 'new' };
    const state = buildReviewOverlayState({ memoOrId: { memoId: 'vm_1', transcriptClean: 'old' }, autoAccept: true, now: 1 });
    expect(isOverlayMemoMissing(state, [live])).toBe(false);
    expect(resolveCurrentMemo(state, [live])).toBe(live);
  });

  it('never fires in redo mode or when closed', () => {
    expect(isOverlayMemoMissing({ open: true, mode: 'redo', memoId: 'x' }, [])).toBe(false);
    expect(isOverlayMemoMissing({ open: false, mode: 'review', memoId: 'x' }, [])).toBe(false);
  });
});
