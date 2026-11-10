// A capture is scoped to one physical controller, never to its rider mapping.
export function createSelectorInputRouter() {
  const captures = new Map(), observers = new Set();
  const key = data => JSON.stringify([data?.selectorId, data?.equipmentId]);
  return {
    capture({ selectorId, equipmentId, onInput }) {
      if (!selectorId || !equipmentId || typeof onInput !== 'function') throw new Error('Invalid selector capture');
      const id = key({ selectorId, equipmentId });
      if (captures.has(id)) throw new Error('Selector already captured');
      captures.set(id, onInput);
      return () => { if (captures.get(id) === onInput) captures.delete(id); };
    },
    onUnclaimed(handler) { observers.add(handler); return () => observers.delete(handler); },
    route(input) {
      const handler = captures.get(key(input));
      if (handler) return handler(input) === true;
      for (const observer of [...observers]) if (observer(input) === true) return true;
      return false;
    },
    clear() { captures.clear(); },
  };
}
