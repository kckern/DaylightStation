/**
 * Who is the grown-up at the keyboard?
 *
 * Sign-off and reassignment are adult-only. The rule is the SAME one
 * `PrintService.#isAdult` applies server-side for print approval: an entry on
 * the household roster whose `birthyear` puts them at 18 or over. An unknown
 * birthyear FAILS CLOSED — it cannot approve — because the alternative is a
 * profile with a missing field silently gaining a parent's authority.
 *
 * There is no login on the Admin app, so identity here is a deliberate choice
 * from the roster, persisted so a parent working through a stack of paper is not
 * re-picking themselves every page. Two things make that honest rather than
 * decorative:
 *
 *  - Only adults are offered. A child is never in the list.
 *  - The stored choice is re-checked against the roster on every load. A
 *    remembered id that is now a child, or has left the roster, yields
 *    `canSignOff: false` — stale or tampered storage cannot buy authority.
 *
 * NOTE FOR ANYONE READING THIS AS A SECURITY BOUNDARY: it is not one. The API
 * accepts any `gradedBy` string without checking it against the roster (see
 * `POST /lifecycle/sessions/:id/review/:itemId`). This hook keeps a child from
 * marking their own work through the UI; it cannot keep anything from doing so
 * through curl.
 *
 * @module Admin/School/useGrader
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'daylight.school.admin.gradedBy';
export const ADULT_AGE = 18;

/**
 * @param {{birthyear?: number|null}|null} user
 * @param {number} [year] - current year, injectable for tests
 * @returns {boolean} false for a missing user OR a missing birthyear
 */
export function isAdult(user, year = new Date().getFullYear()) {
  if (!user || !user.birthyear) return false;
  return year - user.birthyear >= ADULT_AGE;
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStored(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode — the choice just won't persist */ }
}

/**
 * @param {Array<{id: string, name: string, birthyear?: number|null}>} roster
 * @returns {{adults: object[], learners: object[], graderId: string|null,
 *            grader: object|null, canSignOff: boolean, setGraderId: (id: string|null) => void}}
 */
export function useGrader(roster) {
  const list = useMemo(() => (Array.isArray(roster) ? roster : []), [roster]);
  const [graderId, setGraderIdState] = useState(() => readStored());

  const adults = useMemo(() => list.filter((u) => isAdult(u)), [list]);
  const learners = useMemo(() => list.filter((u) => !isAdult(u)), [list]);

  // Re-validated against the CURRENT roster every render: the remembered id is
  // a hint, never a grant.
  const grader = useMemo(
    () => adults.find((u) => u.id === graderId) ?? null,
    [adults, graderId],
  );

  // Exactly one adult in the house and nobody chosen yet — choose them. Any
  // other shape (none, or several) waits for a person to say who they are.
  useEffect(() => {
    if (grader || graderId || adults.length !== 1) return;
    setGraderIdState(adults[0].id);
    writeStored(adults[0].id);
  }, [adults, grader, graderId]);

  const setGraderId = useCallback((id) => {
    setGraderIdState(id || null);
    writeStored(id || null);
  }, []);

  return {
    adults,
    learners,
    graderId,
    grader,
    canSignOff: Boolean(grader),
    setGraderId,
  };
}

export default useGrader;
