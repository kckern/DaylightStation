// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buzzersToSelectors, makeBuzzerSelectHandler } from './buzzerSelectors.mjs';

describe('buzzersToSelectors', () => {
  it('converts gameshow buzzer configs to MQTTSelectorAdapter selector configs', () => {
    const selectors = buzzersToSelectors([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
    expect(selectors).toEqual([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/GameShow Buzzers', equipment: 'gameshow', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
  });
  it('handles empty/missing input', () => {
    expect(buzzersToSelectors(null)).toEqual([]);
    expect(buzzersToSelectors([])).toEqual([]);
  });
});

describe('makeBuzzerSelectHandler', () => {
  it('broadcasts a gameshow buzz for gameshow selections', () => {
    const broadcastEvent = vi.fn();
    const handler = makeBuzzerSelectHandler(broadcastEvent);
    handler({ selectorId: 'lr', equipmentId: 'gameshow', userId: 'slot_1', action: '1_single' });
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gameshow', kind: 'buzz', buzzerId: 'lr', action: '1_single', slot: 'slot_1',
    }));
    expect(typeof broadcastEvent.mock.calls[0][0].ts).toBe('number');
  });
  it('ignores non-gameshow selections', () => {
    const broadcastEvent = vi.fn();
    makeBuzzerSelectHandler(broadcastEvent)({ selectorId: 'x', equipmentId: 'niceday', userId: 'felix', action: '1_single' });
    expect(broadcastEvent).not.toHaveBeenCalled();
  });
});
