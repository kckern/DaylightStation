// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buzzersToSelectors, makeBuzzerSelectHandler, makeSelectorSelectHandler } from './partyGamesBuzzerInput.mjs';

describe('buzzersToSelectors', () => {
  it('converts party-games buzzer configs to MQTTSelectorAdapter selector configs', () => {
    const selectors = buzzersToSelectors([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/Party Games Buzzers', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
    expect(selectors).toEqual([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/Party Games Buzzers', equipment: 'party-games', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
  });
  it('handles empty/missing input', () => {
    expect(buzzersToSelectors(null)).toEqual([]);
    expect(buzzersToSelectors([])).toEqual([]);
  });
});

describe('makeBuzzerSelectHandler', () => {
  it('broadcasts a party-games buzz for party-games selections', () => {
    const broadcastEvent = vi.fn();
    const handler = makeBuzzerSelectHandler(broadcastEvent);
    handler({ selectorId: 'lr', equipmentId: 'party-games', userId: 'slot_1', action: '1_single' });
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gaming', environment: 'party-games', kind: 'buzz', buzzerId: 'lr', action: '1_single', slot: 'slot_1',
    }));
    expect(typeof broadcastEvent.mock.calls[0][0].ts).toBe('number');
  });
  it('ignores non-party-games selections', () => {
    const broadcastEvent = vi.fn();
    makeBuzzerSelectHandler(broadcastEvent)({ selectorId: 'x', equipmentId: 'niceday', userId: 'learner2', action: '1_single' });
    expect(broadcastEvent).not.toHaveBeenCalled();
  });

  it('routes the shared selector stream by semantic equipment type', () => {
    const partyGames = vi.fn();
    const riderSelect = vi.fn();
    const handle = makeSelectorSelectHandler({ partyGames, riderSelect });
    handle({ equipmentId: 'party-games' });
    handle({ equipmentId: 'bike' });
    expect(partyGames).toHaveBeenCalledTimes(1);
    expect(riderSelect).toHaveBeenCalledTimes(1);
  });
});
