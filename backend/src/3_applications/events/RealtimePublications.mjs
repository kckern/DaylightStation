export class LessonPositionReporter {
  constructor({ publish = null, topic = 'school-playback', source = 'lesson-screen', now = () => new Date() }) { this.publish = publish; this.topic = topic; this.source = source; this.now = now; }
  get available() { return typeof this.publish === 'function'; }
  report(sessionId, seconds, { topic = this.topic } = {}) { return this.publish?.(topic, { source: this.source, type: 'progress', sessionId, seconds, percent: null, ts: this.now().toISOString() }); }
}
export class GamingSessionEvents {
  constructor({ publish = null, now = () => Date.now() }) { this.publish = publish; this.now = now; }
  sessionUpdated(sessionId, result) { return this.publish?.({ source: 'gaming-authority', topic: 'gaming', kind: 'session-updated', sessionId, rulesetId: result.header.ruleset.id, revision: result.header.revision, ts: this.now() }); }
}
export class CameraEvents {
  constructor({ publish }) { this.publish = publish; }
  received(cameraId, topic, event) { return this.publish({ topic, event, cameraId }); }
}
export class MediaQueueEvents {
  constructor({ publish }) { this.publish = publish; }
  changed(queue, mutationId) { return this.publish('media:queue', { ...queue, mutationId }); }
}
export class GratitudeEvents {
  constructor({ publish, nowMs = () => Date.now(), timestamp }) { this.publish = publish; this.nowMs = nowMs; this.timestamp = timestamp; }
  customItem(text) {
    const item = { id: this.nowMs(), text: text.trim() };
    const payload = { topic: 'gratitude', item, timestamp: this.timestamp(), type: 'gratitude_item', isCustom: true };
    this.publish(payload);
    return { item, payload };
  }
}
