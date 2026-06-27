import { describe, it, expect } from 'vitest';
import { shouldRelayBtTopic, BT_RELAY_TOPICS } from './btRelay.mjs';

describe('shouldRelayBtTopic', () => {
  it('relays the bt control topics (both directions)', () => {
    ['bt.pair.request','bt.pair.progress','bt_inventory','bt.remove','bt.remove.result']
      .forEach((t) => expect(shouldRelayBtTopic(t)).toBe(true));
  });
  it('does not relay unrelated topics', () => {
    ['fitness','midi','homeline:abc','logging','', undefined, null, 123, {}]
      .forEach((t) => expect(shouldRelayBtTopic(t)).toBe(false));
  });
  it('exposes the whitelist as a Set', () => {
    expect(BT_RELAY_TOPICS instanceof Set).toBe(true);
    expect(BT_RELAY_TOPICS.size).toBe(5);
  });
});
