import '@testing-library/jest-dom';
import { configure } from '@testing-library/dom';

// waitFor/findBy default to a 1s ceiling, which is calibrated for an idle
// machine. A full parallel sweep runs ~1,000 files across every core, and a
// worker starved for a slice past that ceiling fails whichever timing-shaped
// test it happened to be inside — one roaming victim per sweep (QuizRunner,
// AdminPreviewPlayer, WeeklyReview…), each passing every solo run. Raising the
// ceiling changes NOTHING about what must become true — only how long a
// starved worker is allowed to take to observe it.
//
// 5s was still the BINDING ceiling, which is why victims kept appearing after
// `testTimeout` was raised to 20s: a starved `waitFor` gives up at its own
// limit long before the test's, so the 20s only ever governed tests that do
// not wait. Measured 2026-09-06 in a full gate sweep — ArtLibrary's quick-tag
// and WeeklyReview's extent-probe fallback each failed at 5064ms, and each
// takes ~40ms run alone. A 120x stall is scheduling, not logic, so the number
// below has to leave room for it while staying under `testTimeout` (20s) —
// a waitFor outliving its own test only moves the failure.
configure({ asyncUtilTimeout: 15000 });

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
