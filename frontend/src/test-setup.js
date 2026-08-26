import '@testing-library/jest-dom';
import { configure } from '@testing-library/dom';

// waitFor/findBy default to a 1s ceiling, which is calibrated for an idle
// machine. A full parallel sweep runs ~1,000 files across every core, and a
// worker starved for a slice past that ceiling fails whichever timing-shaped
// test it happened to be inside — one roaming victim per sweep (QuizRunner,
// AdminPreviewPlayer, WeeklyReview…), each passing every solo run. Raising the
// ceiling changes NOTHING about what must become true — only how long a
// starved worker is allowed to take to observe it.
configure({ asyncUtilTimeout: 5000 });

// happy-dom doesn't provide localStorage in our custom env. Add a minimal
// in-memory polyfill so persistence tests work consistently across runs.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}
