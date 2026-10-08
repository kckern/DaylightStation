/**
 * Remote Shuffle for a running screen: the order the queue will PLAY in, without touching the listed order, what is
 * playing now, or the items placed Up Next right behind it. Turning it off restores the listed order (from the current
 * item on). Returns the queue unchanged when nothing is playing from it.
 */
export function shuffleExecutionOrder(queue, enabled, random = Math.random) {
  const items = queue?.items ?? [];
  const at = queue?.currentIndex ?? -1;
  if (at < 0 || at >= items.length) return queue;
  let bandEnd = at + 1;
  while (bandEnd < items.length && items[bandEnd].priority === 'upNext') bandEnd += 1;
  const head = items.slice(at, bandEnd).map((item) => item.queueItemId);
  const rest = items.slice(bandEnd).map((item) => item.queueItemId);
  if (enabled) {
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
  }
  return { ...queue, executionOrder: [...head, ...rest] };
}
