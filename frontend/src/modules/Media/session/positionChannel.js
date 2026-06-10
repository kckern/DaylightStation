// frontend/src/modules/Media/session/positionChannel.js
// The hot tier of the two-tier position model. Player progress ticks land
// here at tick rate; only position subscribers (seek bar, timecodes)
// re-render. The durable tier is snapshot.position, written on discrete
// events and the ≥5s cadence. Reconciliation is one-directional: every
// durable position write also sets this channel; the channel never writes
// back into the snapshot.
export function createPositionChannel({ nowFn = () => Date.now() } = {}) {
  let current = { seconds: 0, ts: 0 };
  const subscribers = new Set();

  return {
    get: () => current,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    set(seconds, ts = nowFn()) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
      current = { seconds, ts };
      for (const fn of subscribers) fn(current);
    },
  };
}

export default createPositionChannel;
