import { describe, it, expect } from 'vitest';
import { SchoolTeacherBacklogNudge } from './SchoolTeacherBacklogNudge.mjs';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

// The notifier here builds the REAL domain entity, the way NotificationService
// does. A stub that accepted any shape is how an invalid category shipped: every
// hourly nudge threw inside the entity and the teacher was never told a child
// was blocked on them (2026-09-25, a review item stuck for three days).
const makeNudge = ({ pending = 1, teachers = ['parent'] } = {}) => {
  const sent = [];
  const nudge = new SchoolTeacherBacklogNudge({
    reviewQueue: { listPending: async () => Array.from({ length: pending }, (_, i) => ({ itemId: `i${i}` })) },
    listPendingPrints: () => [],
    reloadSchoolConfig: async () => ({ teachers }),
    notifier: { send: async (raw) => { sent.push(new NotificationIntent(raw)); } },
    clock: { today: () => '2026-09-25' },
    logger: { info() {}, warn() {} },
  });
  return { nudge, sent };
};

describe('SchoolTeacherBacklogNudge', () => {
  it('sends a valid notification intent to each teacher when review work is pending', async () => {
    const { nudge, sent } = makeNudge({ pending: 2, teachers: ['parent', 'other'] });
    const result = await nudge.execute();
    expect(result).toEqual({ kind: 'sent', recipients: 2 });
    expect(sent.map((i) => i.metadata.username)).toEqual(['parent', 'other']);
    expect(sent[0].category).toBe('school');
  });

  it('sends nothing when there is no backlog', async () => {
    const { nudge, sent } = makeNudge({ pending: 0 });
    expect(await nudge.execute()).toEqual({ kind: 'empty' });
    expect(sent).toHaveLength(0);
  });
});
