// Whitelisted bidirectional relay for Bluetooth game-controller management.
// The garage fitness extension and the browser are both WS clients of the bus;
// neither talks to the other unless the backend explicitly rebroadcasts. We
// relay ONLY these BT control topics — never a blanket relay, which would turn
// the bus into an open relay.
export const BT_RELAY_TOPICS = new Set([
  'bt.pair.request',   // browser → extension
  'bt.pair.progress',  // extension → browser
  'bt_inventory',      // extension → browser
  'bt.remove',         // browser → extension
  'bt.remove.result',  // extension → browser
]);

export function shouldRelayBtTopic(topic) {
  return typeof topic === 'string' && BT_RELAY_TOPICS.has(topic);
}
