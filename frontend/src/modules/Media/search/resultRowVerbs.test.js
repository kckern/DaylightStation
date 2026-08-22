import { describe, it, expect, vi } from 'vitest';
import { applyResultRowVerb } from './resultRowVerbs.js';

function makeCtx() {
  return {
    queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() },
    push: vi.fn(),
  };
}

const item = { id: 'plex:1', title: 'Bluey', mediaType: 'video' };

describe('applyResultRowVerb', () => {
  it('playNow calls queue.playNow with clearRest', () => {
    const ctx = makeCtx();
    applyResultRowVerb('playNow', item, ctx);
    expect(ctx.queue.playNow).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: 'plex:1', title: 'Bluey' }),
      { clearRest: true }
    );
  });

  it('playNext calls queue.playNext', () => {
    const ctx = makeCtx();
    applyResultRowVerb('playNext', item, ctx);
    expect(ctx.queue.playNext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1' }));
  });

  it('upNext calls queue.addUpNext', () => {
    const ctx = makeCtx();
    applyResultRowVerb('upNext', item, ctx);
    expect(ctx.queue.addUpNext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1' }));
  });

  it('add calls queue.add', () => {
    const ctx = makeCtx();
    applyResultRowVerb('add', item, ctx);
    expect(ctx.queue.add).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:1' }));
  });

  it('detail pushes the detail view with contentId, touching no queue applier', () => {
    const ctx = makeCtx();
    applyResultRowVerb('detail', item, ctx);
    expect(ctx.push).toHaveBeenCalledWith('detail', { contentId: 'plex:1' });
    expect(ctx.queue.playNow).not.toHaveBeenCalled();
  });

  it('a queue verb with no usable id is a no-op', () => {
    const ctx = makeCtx();
    applyResultRowVerb('playNow', {}, ctx);
    expect(ctx.queue.playNow).not.toHaveBeenCalled();
  });

  it('detail with no id is a no-op', () => {
    const ctx = makeCtx();
    applyResultRowVerb('detail', {}, ctx);
    expect(ctx.push).not.toHaveBeenCalled();
  });

  it('an unknown action is a no-op', () => {
    const ctx = makeCtx();
    applyResultRowVerb('bogus', item, ctx);
    expect(ctx.queue.playNow).not.toHaveBeenCalled();
    expect(ctx.queue.playNext).not.toHaveBeenCalled();
    expect(ctx.queue.addUpNext).not.toHaveBeenCalled();
    expect(ctx.queue.add).not.toHaveBeenCalled();
    expect(ctx.push).not.toHaveBeenCalled();
  });
});
