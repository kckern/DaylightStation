// frontend/src/modules/Media/controller/mockController.js
// In-memory SessionController used by UI work before (and in tests instead
// of) the real engine. Conforms to controllerShape; the conformance suite
// runs against it too, so UI built on the mock binds to the real thing.
import { createIdleSessionSnapshot } from '@shared-contracts/media/shapes.mjs';

let mockIdCounter = 0;

export function createMockController({ kind = 'local', id = `mock-${++mockIdCounter}` } = {}) {
  let snapshot = createIdleSessionSnapshot({ sessionId: `mock-session-${id}`, ownerId: id });
  let position = { seconds: 0, ts: 0 };
  const snapSubs = new Set();
  const posSubs = new Set();

  const notify = () => snapSubs.forEach((fn) => fn(snapshot));

  const set = (patch) => {
    snapshot = { ...snapshot, ...patch, meta: { ...snapshot.meta, updatedAt: new Date().toISOString() } };
    notify();
  };

  const setQueue = (items, currentIndex) => {
    const upNextCount = items.filter((it) => it.priority === 'upNext').length;
    set({ queue: { items, currentIndex, upNextCount } });
  };

  const toQueueItem = (input) => ({
    queueItemId: `qi-${++mockIdCounter}`,
    contentId: input.contentId,
    title: input.title ?? input.contentId,
    format: input.format ?? 'video',
    priority: input.priority ?? 'queue',
    addedAt: new Date().toISOString(),
  });

  const itemFor = (qi) => ({ contentId: qi.contentId, format: qi.format, title: qi.title });

  return {
    kind,
    id,
    getSnapshot: () => snapshot,
    subscribe: (fn) => { snapSubs.add(fn); return () => snapSubs.delete(fn); },
    position: {
      get: () => position,
      subscribe: (fn) => { posSubs.add(fn); return () => posSubs.delete(fn); },
    },
    transport: {
      play: () => set({ state: snapshot.currentItem ? 'playing' : snapshot.state }),
      pause: () => set({ state: snapshot.state === 'playing' ? 'paused' : snapshot.state }),
      stop: () => set({ state: 'idle', currentItem: null, position: 0 }),
      seekAbs: (s) => { position = { seconds: s, ts: Date.now() }; posSubs.forEach((fn) => fn(position)); set({ position: s }); },
      seekRel: (d) => { const s = Math.max(0, (snapshot.position ?? 0) + d); position = { seconds: s, ts: Date.now() }; set({ position: s }); },
      skipNext: () => {
        const q = snapshot.queue;
        if (q.currentIndex < q.items.length - 1) {
          const idx = q.currentIndex + 1;
          set({ currentItem: itemFor(q.items[idx]), position: 0, state: 'playing', queue: { ...q, currentIndex: idx } });
        }
      },
      skipPrev: () => {
        const q = snapshot.queue;
        if (q.currentIndex > 0) {
          const idx = q.currentIndex - 1;
          set({ currentItem: itemFor(q.items[idx]), position: 0, state: 'playing', queue: { ...q, currentIndex: idx } });
        }
      },
    },
    queue: {
      playNow: (input, { clearRest = false } = {}) => {
        const qi = toQueueItem(input);
        const rest = clearRest ? [] : snapshot.queue.items.slice(snapshot.queue.currentIndex + 1);
        setQueue([qi, ...rest], 0);
        set({ currentItem: itemFor(qi), position: 0, state: 'playing' });
      },
      playNext: (input) => {
        const q = snapshot.queue;
        const items = [...q.items];
        items.splice(q.currentIndex + 1, 0, toQueueItem(input));
        setQueue(items, q.currentIndex);
      },
      addUpNext: (input) => {
        const q = snapshot.queue;
        const qi = toQueueItem({ ...input, priority: 'upNext' });
        const lastUpNext = q.items.reduce((acc, it, i) => (it.priority === 'upNext' ? i : acc), q.currentIndex);
        const items = [...q.items];
        items.splice(lastUpNext + 1, 0, qi);
        setQueue(items, q.currentIndex);
      },
      add: (input) => setQueue([...snapshot.queue.items, toQueueItem(input)], snapshot.queue.currentIndex),
      remove: (queueItemId) => {
        const q = snapshot.queue;
        const idx = q.items.findIndex((it) => it.queueItemId === queueItemId);
        if (idx < 0 || idx === q.currentIndex) return;
        const items = q.items.filter((it) => it.queueItemId !== queueItemId);
        setQueue(items, idx < q.currentIndex ? q.currentIndex - 1 : q.currentIndex);
      },
      reorder: ({ from, to }) => {
        const q = snapshot.queue;
        const items = [...q.items];
        const fromIdx = items.findIndex((it) => it.queueItemId === from);
        const toIdx = items.findIndex((it) => it.queueItemId === to);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        setQueue(items, items.findIndex((it) => it.queueItemId === q.items[q.currentIndex]?.queueItemId));
      },
      jump: (queueItemId) => {
        const q = snapshot.queue;
        const idx = q.items.findIndex((it) => it.queueItemId === queueItemId);
        if (idx < 0) return;
        set({ currentItem: itemFor(q.items[idx]), position: 0, state: 'playing', queue: { ...q, currentIndex: idx } });
      },
      clear: () => { setQueue([], -1); },
    },
    config: {
      setShuffle: (enabled) => set({ config: { ...snapshot.config, shuffle: !!enabled } }),
      setRepeat: (mode) => set({ config: { ...snapshot.config, repeat: mode } }),
      setShader: (shader) => set({ config: { ...snapshot.config, shader } }),
      setVolume: (level) => set({ config: { ...snapshot.config, volume: level } }),
    },
    lifecycle: {
      reset: () => {
        snapshot = createIdleSessionSnapshot({ sessionId: `mock-session-${id}`, ownerId: id });
        notify();
      },
      adoptSnapshot: (snap) => { snapshot = snap; notify(); },
    },
    portability: {
      snapshotForHandoff: () => snapshot,
      receiveClaim: (snap) => { snapshot = snap; notify(); },
    },
    capabilities: { seekable: true, acked: kind === 'remote' },
  };
}

export default createMockController;
