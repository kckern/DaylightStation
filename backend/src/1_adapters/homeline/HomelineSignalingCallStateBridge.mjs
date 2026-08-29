/** Translates legacy websocket signaling frames into semantic call-state facts. */
export class HomelineSignalingCallStateBridge {
  constructor({ callState }) { this.callState = callState; }

  handle(message) {
    const { topic, type, from } = message || {};
    if (!topic?.startsWith('homeline:')) return;
    const deviceId = topic.slice('homeline:'.length);
    if (type === 'offer' && from?.startsWith('phone-')) {
      this.callState.started({ deviceId, phonePeerId: from });
    } else if (type === 'hangup') {
      this.callState.ended(deviceId);
    }
  }
}

export default HomelineSignalingCallStateBridge;
