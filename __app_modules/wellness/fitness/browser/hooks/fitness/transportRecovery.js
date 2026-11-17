/** Monotonic browser-delivery watchdog. Health is evidence, never a sample. */
export function createTransportRecovery({
  now = () => performance.now(), refreshSubscription, reconnect, onState = () => {},
  onIncident = () => {}, onEscalate = () => {},
}) {
  let disposed = false;
  let activeSince = null;
  let sampleAt = null;
  let bootId = null;
  let sampleSeq = -1;
  const retiredBoots = new Set();
  let health = null;
  let incident = null;
  let attempts = [];
  let cancelReconnect = null;
  let snapshot = { state: 'quiet', reason: 'inactive', incidentId: null, since: now() };

  const cancel = () => { cancelReconnect?.(); cancelReconnect = null; };
  function publish(state, reason, silenceMs = 0) {
    const incidentId = incident?.id ?? null;
    if (snapshot.state !== state || snapshot.reason !== reason || snapshot.incidentId !== incidentId) {
      snapshot = { state, reason, incidentId, since: now(), bootId, silenceMs };
      onState(snapshot);
    }
    return snapshot;
  }
  const event = (type, silenceMs) => ({
    type, incidentId: incident.id, state: snapshot.state, reason: snapshot.reason,
    bootId, silenceMs, timestamp: new Date().toISOString(),
  });
  function acceptBoot(next) {
    if (!next) return bootId === null; // legacy samples work until a versioned bridge is observed
    if (retiredBoots.has(next)) return false;
    if (bootId !== next) {
      if (bootId) retiredBoots.add(bootId);
      bootId = next;
      sampleSeq = -1;
      health = null;
    }
    return true;
  }
  function attempt(action) {
    const time = now();
    attempts = attempts.filter(at => time - at < 120000);
    if (attempts.length >= 2) return false;
    attempts.push(time);
    action();
    return true;
  }
  return {
    observeHealth(packet) {
      if (disposed || packet?.protocol !== 1 || !packet.bootId || !Number.isSafeInteger(packet.sourceSeq) || packet.sourceSeq < 0) return false;
      if (!acceptBoot(packet.bootId)) return false;
      if (health && packet.sourceSeq < health.sourceSeq) return false;
      health = { sourceSeq: packet.sourceSeq, lastSourceAgeMs: packet.lastSourceAgeMs, at: now() };
      return true;
    },
    acceptsSample({ bootId: nextBoot, seq } = {}) {
      if (disposed || (nextBoot && retiredBoots.has(nextBoot)) || (!nextBoot && bootId !== null)) return false;
      return !nextBoot || (Number.isSafeInteger(seq) && seq >= 0 && (nextBoot !== bootId || seq > sampleSeq));
    },
    observeSample({ bootId: nextBoot, seq } = {}) {
      if (disposed || !acceptBoot(nextBoot)) return false;
      if (nextBoot && (!Number.isSafeInteger(seq) || seq <= sampleSeq)) return false;
      if (nextBoot) sampleSeq = seq;
      sampleAt = now();
      cancel();
      if (incident) {
        onIncident({ ...event('recovered', sampleAt - incident.startedAt), state: 'healthy', reason: 'sample-delivered' });
        incident = null;
      }
      publish('healthy', 'sample-delivered');
      return true;
    },
    tick({ active, stopped = false }) {
      if (disposed) return snapshot;
      if (!active || stopped) {
        activeSince = null;
        cancel();
        return publish('quiet', stopped ? 'stopped' : 'inactive');
      }
      if (activeSince === null) activeSince = sampleAt !== null && now() - sampleAt < 5000 ? sampleAt : now();
      const silenceMs = now() - Math.max(sampleAt ?? activeSince, activeSince);
      if (sampleAt !== null && now() - sampleAt < 5000) return publish('healthy', 'sample-delivered', silenceMs);
      const healthFresh = health && now() - health.at < 15000;
      const sourceQuiet = healthFresh && (health.lastSourceAgeMs === null ||
        (Number.isFinite(health.lastSourceAgeMs) && health.lastSourceAgeMs + now() - health.at >= 5000));
      if (sourceQuiet) {
        cancel();
        return publish('quiet', 'source-quiet', silenceMs);
      }
      const reason = healthFresh && health.sourceSeq > sampleSeq ? 'delivery-gap' : 'health-missing';
      if (silenceMs < 15000) return publish('suspect', reason, silenceMs);
      if (!incident) {
        incident = { id: globalThis.crypto?.randomUUID?.() ?? `fitness-${Date.now()}-${now()}`, startedAt: now() - silenceMs, refreshed: false, reconnected: false, escalated: false };
        publish('recovering', reason, silenceMs);
        onIncident(event('stalled', silenceMs));
      }
      publish(silenceMs >= 60000 ? 'lost' : 'recovering', reason, silenceMs);
      if (!incident.refreshed) incident.refreshed = attempt(() => refreshSubscription());
      if (silenceMs >= 30000 && !incident.reconnected) {
        incident.reconnected = attempt(() => { cancelReconnect = reconnect(); });
      }
      if (silenceMs >= 60000 && !incident.escalated) {
        incident.escalated = true;
        onEscalate(event('lost', silenceMs));
      }
      return snapshot;
    },
    requestReconnect() {
      if (!disposed) attempt(() => { cancelReconnect = reconnect(); });
    },
    dispose() { disposed = true; cancel(); },
  };
}
