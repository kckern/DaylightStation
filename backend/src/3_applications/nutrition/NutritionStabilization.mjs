import { reviewExpired, stabilizeReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';

/** Deterministic finalization is independent of AI availability and notification
 * settings. Each versioned transition has a durable, idempotent ledger receipt. */
export class NutritionStabilization {
  constructor({ items, review, clock, logger }) { Object.assign(this, { items, review, clock, logger }); }
  async run(userId) {
    await this.review.recover(userId);
    return this.review.runExclusive(userId, async () => {
      const now = this.clock.now();
      const rows = await this.items.findByDateRange(userId, '0001-01-01', '9999-12-31');
      let count = 0;
      for (const row of rows.filter(item => reviewExpired(item, now))) {
        const id = row.uuid || row.id;
        const result = await this.items.mutateEntries(userId, {
          updates: [{ id, expectedVersion: row.version, changes: stabilizeReview(row, now) }],
          audit: { id: `stabilize:${id}:${row.review.startedAt}`, fingerprint: row.review.stabilizesAt,
            actor: 'review-clock', reason: '72-hour provisional review completed', at: new Date(now).toISOString() },
          validate: ({ before }) => {
            const current = before.find(item => (item.uuid || item.id) === id);
            if (!current || !reviewExpired(current, now) || current.settledBy === 'user') throw Object.assign(new Error('Review changed before stabilization'), { status: 409 });
          },
        });
        count += result.affectedIds?.length || 0;
      }
      if (count) this.logger?.info?.('nutrition.review.stabilized', { userId, count });
      return count;
    });
  }
}
