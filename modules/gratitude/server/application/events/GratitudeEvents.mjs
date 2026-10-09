export class GratitudeEvents {
  constructor({ publish, nowMs = () => Date.now(), timestamp }) { this.publish = publish; this.nowMs = nowMs; this.timestamp = timestamp; }
  customItem(text) {
    const item = { id: this.nowMs(), text: text.trim() };
    const payload = { topic: 'gratitude', item, timestamp: this.timestamp(), type: 'gratitude_item', isCustom: true };
    this.publish(payload);
    return { item, payload };
  }
}
