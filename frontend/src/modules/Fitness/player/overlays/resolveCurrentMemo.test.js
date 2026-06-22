import { describe, it, expect } from 'vitest';

import { resolveCurrentMemo } from './resolveCurrentMemo.js';

const memo = (memoId, transcriptClean) => ({ memoId, transcriptClean });

describe('resolveCurrentMemo', () => {
  it('prefers the LIVE list copy over a stale inline snapshot (redo replaced in place)', () => {
    const overlayState = {
      memoId: 'm1',
      memo: memo('m1', 'ORIGINAL transcript'), // stale inline snapshot kept on the overlay
    };
    const voiceMemos = [memo('m1', 'REDONE transcript')]; // manager has the replacement

    const result = resolveCurrentMemo(overlayState, voiceMemos);
    expect(result.transcriptClean).toBe('REDONE transcript');
  });

  it('falls back to the inline snapshot for a retroactive memo not in the list', () => {
    const overlayState = { memoId: 'm9', memo: memo('m9', 'retroactive') };
    const result = resolveCurrentMemo(overlayState, []); // not in list yet
    expect(result.transcriptClean).toBe('retroactive');
  });

  it('looks up by memoId when no inline snapshot is present', () => {
    const overlayState = { memoId: 'm2' };
    const voiceMemos = [memo('m1', 'a'), memo('m2', 'b')];
    expect(resolveCurrentMemo(overlayState, voiceMemos).transcriptClean).toBe('b');
  });

  it('returns null when there is no target and no inline memo', () => {
    expect(resolveCurrentMemo({}, [memo('m1', 'a')])).toBeNull();
    expect(resolveCurrentMemo(null, [])).toBeNull();
  });

  it('handles numeric/string memoId mismatch', () => {
    const overlayState = { memoId: 123 };
    const voiceMemos = [memo('123', 'numeric')];
    expect(resolveCurrentMemo(overlayState, voiceMemos).transcriptClean).toBe('numeric');
  });
});
