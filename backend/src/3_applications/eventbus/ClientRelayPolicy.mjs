export const BT_RELAY_TOPICS = new Set([
  'bt.pair.request',
  'bt.pair.progress',
  'bt_inventory',
  'bt.remove',
  'bt.remove.result',
]);

export const KIOSK_LAUNCH_RELAY_TOPICS = new Set([
  'kiosk.launch',
  'kiosk.launch.result',
]);

export function shouldRelayBtTopic(topic) {
  return typeof topic === 'string' && BT_RELAY_TOPICS.has(topic);
}

export function shouldRelayKioskLaunchTopic(topic) {
  return typeof topic === 'string' && KIOSK_LAUNCH_RELAY_TOPICS.has(topic);
}
