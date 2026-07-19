// Whitelisted relay for parent-initiated kiosk app launches (admin ⇄ kiosk SPA).
// The admin browser and the tablet's kiosk WebView are both WS clients of the
// bus; neither talks to the other unless the backend explicitly rebroadcasts.
//
// Why relay rather than a REST endpoint: the launch has to run *in the kiosk
// page*, because passing intent extras (RetroArch's ROM/LIBRETRO) needs FKB's
// in-page `fully.startIntent` — see frontend/src/lib/fkb.js. The backend has no
// way to reach that from outside the page, so the command is delivered to the
// page and executed there.
//
// Device targeting is enforced client-side: the kiosk hook drops any message
// whose `deviceId` is not its own KIOSK_DEVICE_ID. That mirrors how the bus
// already treats per-device topics (see WebSocketEventBus.broadcast — frontend
// subscriptions sync as '*', so client-side filtering is the real guardrail).
//
// Whitelist only — never a blanket relay, which would turn the bus into an open
// relay between every connected client.
export const KIOSK_LAUNCH_RELAY_TOPICS = new Set([
  'kiosk.launch',         // admin → kiosk: launch this contentId here
  'kiosk.launch.result',  // kiosk → admin: what happened
]);

export function shouldRelayKioskLaunchTopic(topic) {
  return typeof topic === 'string' && KIOSK_LAUNCH_RELAY_TOPICS.has(topic);
}
