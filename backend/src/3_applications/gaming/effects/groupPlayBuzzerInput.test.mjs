// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buzzersToSelectors, makeBuzzerSelectHandler } from './groupPlayBuzzerInput.mjs';

describe('buzzersToSelectors', () => {
  it('converts group-play buzzer configs to MQTTSelectorAdapter selector configs', () => {
    const selectors = buzzersToSelectors([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/Group Play Buzzers', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
    expect(selectors).toEqual([
      { id: 'lr', mqtt_topic: 'zigbee2mqtt/Group Play Buzzers', equipment: 'group-play', buttons: { '1_single': 'slot_1', '2_single': 'slot_2' } },
    ]);
  });
  it('handles empty/missing input', () => {
    expect(buzzersToSelectors(null)).toEqual([]);
    expect(buzzersToSelectors([])).toEqual([]);
  });
});

describe('makeBuzzerSelectHandler', () => {
  it('broadcasts a group-play buzz for group-play selections', () => {
    const broadcastEvent = vi.fn();
    const handler = makeBuzzerSelectHandler(broadcastEvent);
    handler({ selectorId: 'lr', equipmentId: 'group-play', userId: 'slot_1', action: '1_single' });
    expect(broadcastEvent).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'gaming', environment: 'group-play', kind: 'buzz', buzzerId: 'lr', action: '1_single', slot: 'slot_1',
    }));
    expect(typeof broadcastEvent.mock.calls[0][0].ts).toBe('number');
  });
  it('ignores non-group-play selections', () => {
    const broadcastEvent = vi.fn();
    makeBuzzerSelectHandler(broadcastEvent)({ selectorId: 'x', equipmentId: 'niceday', userId: 'learner2', action: '1_single' });
    expect(broadcastEvent).not.toHaveBeenCalled();
  });
});
