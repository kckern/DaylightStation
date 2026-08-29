import { formatIsoLocal, formatLocalTimestamp } from '#domains/core/utils/time.mjs';

class BaseGateway {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  emit(topic, payload) { this.eventBus.broadcast(topic, payload); }
}

export class FoodScaleFirmwareGateway extends BaseGateway {
  constructor({ eventBus, config = {}, timezone }) { super({ eventBus }); this.config = config; this.timezone = timezone; }
  subscribe(listener) {
    return this.eventBus.onClientMessage((clientId, frame) => {
      if (!['food-scale-relay', 'kitchen-relay'].includes(frame?.source)) return;
      const id = typeof frame.id === 'string' && frame.id ? frame.id : 'unknown';
      const ts = formatLocalTimestamp(new Date(), this.timezone);
      let event = null;
      if (frame.type === 'scale' && Number.isFinite(Number(frame.grams))) event = { id, grams: Number(frame.grams), stable: !!frame.stable, unit: frame.unit || 'g', ts, source: 'ble-relay' };
      if (frame.type === 'button') event = { id, event: 'button', press: frame.press === 'long' ? 'long' : 'short', ts };
      if (!event) return;
      listener(event, { clientId }); this.publish(id, event);
    });
  }
  publish(id, event) { this.emit(this.config.scales?.[id]?.topic || 'food-scale', event); }
}

export class BarcodeFirmwareGateway extends BaseGateway {
  constructor({ eventBus, defaultDevice, defaultRoute, timezone }) { super({ eventBus }); this.defaultDevice = defaultDevice; this.defaultRoute = defaultRoute; this.timezone = timezone; }
  subscribe(listener) {
    return this.eventBus.onClientMessage((clientId, frame) => {
      if (!['barcode-relay', 'kitchen-relay'].includes(frame?.source) || frame.type !== 'scan') return;
      const code = typeof frame.code === 'string' ? frame.code.trim() : ''; if (!code) return;
      const device = typeof frame.device === 'string' && frame.device ? frame.device : this.defaultDevice;
      const route = ['content', 'nutribot'].includes(frame.route) ? frame.route : this.defaultRoute;
      const event = { source: 'barcode-relay', device, route, code, ts: formatLocalTimestamp(new Date(), this.timezone) };
      listener(event, { clientId }); this.publish(device, event);
    });
  }
  publish(_device, event) { this.emit('barcode-relay', event); }
}

const normalizeMarks = (marks) => {
  if (!Array.isArray(marks) || !marks.length) return null;
  const out = marks.map(Number); return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 4095) ? out : null;
};
export class OmrFirmwareGateway extends BaseGateway {
  constructor({ eventBus, config = {}, timezone }) { super({ eventBus }); this.config = config; this.timezone = timezone; }
  subscribe(listener) {
    return this.eventBus.onClientMessage((clientId, frame) => {
      if (frame?.source !== 'omr-relay') return;
      const id = typeof frame.id === 'string' && frame.id ? frame.id : 'unknown';
      const ageMs = Number(frame.ageMs); const readAt = Number.isFinite(ageMs) && ageMs > 0 ? new Date(Date.now() - ageMs) : new Date();
      const ts = formatLocalTimestamp(readAt, this.timezone); let event = null;
      if (frame.type === 'relay-status') event = { id, event: 'relay-status', queued: Number(frame.queued) || 0, dropped: Number(frame.dropped) || 0, truncated: Number(frame.truncated) || 0, ts, source: 'omr-relay' };
      if (frame.type === 'sheet') { const marks = normalizeMarks(frame.marks); if (marks) event = { id, event: 'sheet', columns: marks.length, markedColumns: marks.filter(Boolean).length, marks, ts, source: 'omr-relay' }; }
      if (frame.type === 'nfc') { const uid = typeof frame.uid === 'string' ? frame.uid.trim().toUpperCase() : ''; if (/^[0-9A-F]{8,20}$/.test(uid)) event = { id, event: 'nfc', uid, piccType: typeof frame.piccType === 'string' ? frame.piccType : null, atqa: Number.isFinite(Number(frame.atqa)) ? Number(frame.atqa) : null, sak: Number.isFinite(Number(frame.sak)) ? Number(frame.sak) : null, ts, source: 'omr-relay' }; }
      if (frame.type === 'reader-error') event = { id, event: 'reader-error', echo: frame.echo ?? null, ts, source: 'omr-relay' };
      if (frame.type === 'raw') event = { id, event: 'raw', hex: frame.hex ?? null, len: Number(frame.len) || 0, ts, source: 'omr-relay' };
      if (!event) return;
      if (listener(event, { clientId }) !== false) this.publish(id, event);
    });
  }
  publish(id, event) { this.emit(this.config.scanners?.[id]?.topic || 'omr', event); }
}

export class RelayWatchdogFirmwareGateway {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  subscribe(sources, listener) {
    return this.eventBus.onClientMessage((_clientId, frame) => {
      if (!frame?.source || !sources[frame.source]) return;
      listener({ relayId: frame.source, kind: frame.type === 'hello' ? 'hello' : 'heartbeat',
        bootCount: Number.isFinite(frame.boot_count) ? frame.boot_count : undefined, lastReset: frame.last_reset ?? null });
    });
  }
}

export class AutomotiveFirmwareGateway extends BaseGateway {
  constructor({ eventBus, config = {}, timezone, now = Date.now }) { super({ eventBus }); this.config = config; this.timezone = timezone; this.now = now; }
  subscribe(listener) {
    return this.eventBus.onClientMessage((clientId, frame) => {
      if (frame?.source !== 'obd-relay') return;
      const { source: _source, type: kind, ...payload } = frame;
      const id = typeof payload.id === 'string' && payload.id ? payload.id : 'unknown'; const at = this.now();
      listener({ clientId, id, kind, payload, at, ts: formatIsoLocal(new Date(at), this.timezone) });
    });
  }
  publish(id, event) { this.emit(this.config.vehicles?.[id]?.topic || 'automotive', event); }
  acknowledgeTrip(clientId, tripId) { return this.eventBus.sendToClient?.(clientId, { type: 'trip-ack', trip_id: tripId }); }
}
