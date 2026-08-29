/** Applies optional surround semantics to a resolved queue before HTTP projection. */
export class QueuePresentationService {
  constructor({ surroundStore = null, surroundPlanner = null, enforceOrder = true, logger = console } = {}) {
    this.store = surroundStore;
    this.planner = surroundPlanner;
    this.enforceOrder = enforceOrder;
    this.logger = logger?.child?.({ app: 'surround', module: 'queue-router' }) ?? logger;
  }

  prepare({ containerId, items, limit = null }) {
    const plan = this.planner?.({
      surroundStore: this.store,
      containerId,
      items,
      enforceOrder: this.enforceOrder,
      logger: this.logger,
    }) ?? null;
    const ordered = plan ? plan.items : items;
    const selected = limit ? ordered.slice(0, limit) : ordered;
    const prepared = selected.map((item) => {
      try {
        const part = plan?.surroundFor.get(item.id) ?? null;
        const surround = part?.payload ?? (plan?.refused ? null : this.store?.lookup(item.id, item.title));
        if (!surround) return item;
        const result = { ...item, surround };
        if (part) Object.assign(result, { surroundPart: part.part, resumePosition: null, resume: false });
        this.logger?.debug?.('surround.attach', {
          contentId: item.id,
          surroundId: surround.id,
          path: 'queue',
          ...(part ? { containerId, part: part.part } : {}),
        });
        return result;
      } catch (error) {
        this.logger?.warn?.('surround.attach.failed', { contentId: item.id, error: error?.message });
        return item;
      }
    });
    return {
      items: prepared,
      totalDuration: prepared.reduce((sum, item) => sum + (item.duration || 0), 0),
    };
  }
}

export default QueuePresentationService;
