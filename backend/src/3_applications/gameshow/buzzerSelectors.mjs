/**
 * Bridges gameshow.yml `buzzers` into the existing MQTTSelectorAdapter.
 *
 * A buzzer config is a selector whose buttons map zigbee actions to team
 * SLOTS (slot_1..slot_N) instead of user ids. We tag them with
 * equipment: 'gameshow' so the shared onSelect callback can route them.
 */
export function buzzersToSelectors(buzzers) {
  return (Array.isArray(buzzers) ? buzzers : []).map((b) => ({
    id: b.id,
    mqtt_topic: b.mqtt_topic,
    equipment: 'gameshow',
    buttons: b.buttons || {},
  }));
}

export function makeBuzzerSelectHandler(broadcastEvent) {
  return (selection) => {
    if (selection?.equipmentId !== 'gameshow') return;
    broadcastEvent({
      topic: 'gameshow',
      kind: 'buzz',
      buzzerId: selection.selectorId,
      action: selection.action,
      slot: selection.userId, // MQTTSelectorAdapter's generic "mapped value"
      ts: Date.now(),
    });
  };
}
