import { describe, expect, it } from 'vitest';
import { DiscardingRecordings } from './DiscardingRecordings.mjs';

const at = { package: 'korean-vocab', learnerId: 'kid', day: '2026-09-22' };

describe('DiscardingRecordings (test mode sink)', () => {
  it('numbers takes per word in memory and keeps nothing', () => {
    const sink = new DiscardingRecordings();
    expect(sink.save({ ...at, wordId: 'gawi', buffer: Buffer.from('one') })).toEqual({ take: 1 });
    expect(sink.save({ ...at, wordId: 'gawi', buffer: Buffer.from('two') })).toEqual({ take: 2 });
    expect(sink.save({ ...at, wordId: 'pul', buffer: Buffer.from('x') })).toEqual({ take: 1 });
    expect(sink.save({ ...at, package: 'spanish-vocab', wordId: 'gawi', buffer: Buffer.from('x') })).toEqual({ take: 1 });
    expect(sink.latest({ ...at, wordId: 'gawi' })).toBeNull();
  });
});
