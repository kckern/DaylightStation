// backend/src/domains/content/capabilities/Queueable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'sequential' | 'shuffle' | 'heuristic'} TraversalMode
 */

/**
 * Queueable capability - items that can resolve to a queue of playables.
 *
 * Key distinction:
 * - play() → returns SINGLE next-up item (respects watch state)
 * - queue() → returns ALL items in order (for binge watching)
 */
export class QueueableItem extends Item {
  /**
   * @param {Object} props
   * @param {TraversalMode} [props.traversalMode='sequential']
   * @param {boolean} [props.isQueueContainer=false] - true if this contains children to resolve
   */
  constructor(props) {
    super(props);
    this.traversalMode = props.traversalMode ?? 'sequential';
    this.isQueueContainer = props.isQueueContainer ?? false;
  }
}

export default QueueableItem;
