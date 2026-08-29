/**
 * Who counts as a grown-up (spec: print approval, review sign-off, planning).
 *
 * THE ONE COPY. This rule decides who may approve a print, sign off a child's
 * schoolwork, and change what a child is assigned. It used to be a private
 * method on `PrintService` and a separate hook in the browser, and the lifecycle
 * routes had no copy at all — which is exactly how `POST .../review/:itemId`
 * came to accept any `gradedBy` string a child could type. A predicate that
 * decides authority must exist once.
 *
 * It is pure given a roster and a clock, so it lives in the domain: no I/O, no
 * `Date.now()`, no config. Callers hand it the roster they already hold and the
 * time they already read.
 *
 * FAIL CLOSED, DELIBERATELY. An id that is not on the roster is not an adult,
 * and a profile whose `birthyear` is missing is not an adult either. The second
 * one is the interesting case: a household member added in a hurry, with the
 * year left blank, must not silently acquire a parent's authority. The cost of
 * the closed default is a grown-up filling in their birthyear; the cost of the
 * open one is a child signing off their own work.
 *
 * Year arithmetic, not birthday arithmetic: the roster records a year, not a
 * date, so "18 or over" means the calendar year difference. Someone whose
 * eighteenth birthday is in December counts from January. That is the same
 * comparison `PrintService` has always made, kept exactly.
 *
 * @module domains/school/people
 */

/** The age at which a household member may act for a child. */
export const ADULT_AGE = 18;

/**
 * @param {object} args
 * @param {Array<{id?: string, birthyear?: number|null}>} args.roster - the
 *   household roster; anything that is not an array means "nobody is known",
 *   which resolves to false rather than throwing
 * @param {string|null} args.userId - the id claiming the authority
 * @param {number|Date|string} [args.now] - epoch millis, a Date, or an ISO
 *   string. Injected so authority never depends on an ambient clock.
 * @returns {boolean} true only for a roster member with a known birthyear that
 *   puts them at {@link ADULT_AGE} or over
 */
export function isAdult({ roster, userId, now } = {}) {
  if (typeof userId !== 'string' || !userId) return false;
  if (!Array.isArray(roster)) return false;

  const member = roster.find((r) => r && typeof r === 'object' && r.id === userId);
  if (!member) return false;

  const birthyear = Number(member.birthyear);
  if (!Number.isFinite(birthyear) || birthyear <= 0) return false;

  if (now === undefined || now === null) return false;
  const at = new Date(now);
  const year = at.getUTCFullYear();
  if (!Number.isFinite(year)) return false;

  return year - birthyear >= ADULT_AGE;
}

export default isAdult;
