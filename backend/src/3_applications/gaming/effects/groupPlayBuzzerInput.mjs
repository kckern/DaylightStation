/**
 * Bridges the group-play environment profile into MQTTSelectorAdapter.
 *
 * A buzzer config is a selector whose buttons map zigbee actions to team
 * SLOTS (slot_1..slot_N) instead of user ids. We tag them with
 * equipment: 'group-play' so the shared onSelect callback can route them.
 */
export function buzzersToSelectors(buzzers) {
  return (Array.isArray(buzzers) ? buzzers : []).map((b) => ({
    id: b.id,
    mqtt_topic: b.mqtt_topic,
    equipment: 'group-play',
    buttons: b.buttons || {},
  }));
}

export function makeBuzzerSelectHandler(broadcastEvent, observability = null) {
  return (selection) => {
    if (selection?.equipmentId !== 'group-play') return;
    observability?.rawInput({ source: 'mqtt-selector', selector_id: selection.selectorId, action: selection.action });
    broadcastEvent({
      topic: 'gaming',
      environment: 'group-play',
      kind: 'buzz',
      buzzerId: selection.selectorId,
      action: selection.action,
      slot: selection.userId, // MQTTSelectorAdapter's generic "mapped value"
      ts: Date.now(),
    });
  };
}
