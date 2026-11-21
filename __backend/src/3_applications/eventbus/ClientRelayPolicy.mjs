export const BT_RELAY_TOPICS = new Set([
  'bt.pair.request',
  'bt.pair.progress',
  'bt_inventory',
  'bt.remove',
  'bt.remove.result',
  'bt.scan.request',
  'bt.scan.progress',
  'bt.inventory.request',
  'bt.remote.key',
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

// Diagnostics have their own route; they must never become fitness samples.
export const FITNESS_DIAGNOSTIC_TOPICS = new Set(['fitness.transport.health']);

export function shouldRelayFitnessDiagnosticTopic(topic) {
  return typeof topic === 'string' && FITNESS_DIAGNOSTIC_TOPICS.has(topic);
}
