/**
 * Bridges the party-games environment profile into MQTTSelectorAdapter.
 *
 * A buzzer config is a selector whose buttons map zigbee actions to team
 * SLOTS (slot_1..slot_N) instead of user ids. We tag them with
 * equipment: 'party-games' so the shared onSelect callback can route them.
 */
export function buzzersToSelectors(buzzers) {
  return (Array.isArray(buzzers) ? buzzers : []).map((b) => ({
    id: b.id,
    mqtt_topic: b.mqtt_topic,
    equipment: 'party-games',
    buttons: b.buttons || {},
  }));
}

export function makeBuzzerSelectHandler(broadcastEvent, observability = null, clock = () => Date.now()) {
  return (selection) => {
    if (selection?.equipmentId !== 'party-games') return;
    observability?.rawInput({ source: 'mqtt-selector', selector_id: selection.selectorId, action: selection.action });
    broadcastEvent({
      topic: 'gaming',
      environment: 'party-games',
      kind: 'buzz',
      buzzerId: selection.selectorId,
      action: selection.action,
      slot: selection.userId, // MQTTSelectorAdapter's generic "mapped value"
      ts: clock(),
    });
  };
}

/** Routes the shared selector stream to party-games or ordinary rider selection. */
export function makeSelectorSelectHandler({ partyGames, riderSelect }) {
  return (selection) => selection?.equipmentId === 'party-games'
    ? partyGames(selection)
    : riderSelect(selection);
}
