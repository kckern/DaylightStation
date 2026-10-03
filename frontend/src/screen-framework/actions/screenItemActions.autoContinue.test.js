import { describe, it, expect } from 'vitest';
import { createScreenItemActions, getScreenItemActions } from './screenItemActions.js';
import { createLocalSessionController } from '../../modules/Media/session/LocalSessionController.js';

function ownerSource() {
  const c = createLocalSessionController({ clientId: 'screen' });
  c.queue.playNow({ contentId: 'old', format: 'video' });
  return {
    c,
    source: {
      capture: c.portability.capture,
      applyQueue: (queue) => { c.store.replace({ ...c.getSnapshot(), queue }); return { ok: true }; },
      adopt: c.portability.adopt,
    },
  };
}

describe('screen item actions — auto-continue batches', () => {
  it('adds a whole batch as ONE undoable operation and marks every item addedBy', async () => {
    const { c, source } = ownerSource();
    const actions = createScreenItemActions({ source, targetId: 'screen' });
    const result = await actions.execute({
      kind: 'add', item: { contentId: 'a', format: 'video' },
      collectionItems: [{ contentId: 'a', format: 'video' }, { contentId: 'b', format: 'video' }],
      operationId: 'auto-1', tappedAt: Date.now(), addedBy: 'auto-continue',
    });
    expect(result).toMatchObject({ ok: true, count: 2 });
    const added = c.getSnapshot().queue.items.filter((it) => it.contentId !== 'old');
    expect(added.map((it) => [it.contentId, it.addedBy, it.itemActionId])).toEqual([
      ['a', 'auto-continue', 'auto-1'], ['b', 'auto-continue', 'auto-1'],
    ]);
    await actions.undo('auto-1');
    expect(c.getSnapshot().queue.items.map((it) => it.contentId)).toEqual(['old']);
  });

  it('shares one owner (and one undo ledger) per session source', () => {
    const { source } = ownerSource();
    expect(getScreenItemActions(source)).toBe(getScreenItemActions(source));
  });
});
