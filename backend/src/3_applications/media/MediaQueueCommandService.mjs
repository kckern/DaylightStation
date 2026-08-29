/** Application workflow behind the legacy media websocket command envelope. */
export class MediaQueueCommandService {
  constructor({ queues, publications, createQueueId }) {
    if (!queues?.load || !queues?.replace || !queues?.clear) throw new Error('MediaQueueCommandService requires queues');
    if (!publications?.changed) throw new Error('MediaQueueCommandService requires publications');
    if (typeof createQueueId !== 'function') throw new Error('MediaQueueCommandService requires createQueueId');
    this.queues = queues;
    this.publications = publications;
    this.createQueueId = createQueueId;
  }

  async execute({ action, contentId, householdId }) {
    if (!['play', 'add', 'next', 'clear', 'queue'].includes(action)) return { kind: 'unknown_action' };

    let queue;
    if (action === 'clear') {
      queue = await this.queues.clear(householdId);
    } else {
      queue = await this.queues.load(householdId);
      if (action === 'queue') {
        queue.clear();
        queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], 'end', this.createQueueId);
        queue.position = 0;
      } else {
        const placement = action === 'add' ? 'end' : 'next';
        const added = queue.addItems([{ contentId, addedFrom: 'WEBSOCKET' }], placement, this.createQueueId);
        if (action === 'play') {
          const insertedIndex = queue.items.findIndex((item) => item.queueId === added[0].queueId);
          if (insertedIndex >= 0) queue.position = insertedIndex;
        }
      }
      await this.queues.replace(queue, householdId);
    }

    const snapshot = {
      position: queue.position,
      shuffle: queue.shuffle,
      repeat: queue.repeat,
      volume: queue.volume,
      items: queue.items.map((item) => ({ ...item })),
      shuffleOrder: [...queue.shuffleOrder],
    };
    this.publications.changed(snapshot);
    return { kind: 'completed' };
  }
}

export default MediaQueueCommandService;
