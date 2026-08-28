/**
 * Which single forward action a result receipt offers after a pass.
 *
 * Pure: no clock, no I/O. It consumes the agenda sections `CloseSessionOutcome`
 * already projects and returns at most ONE offer.
 *
 * THE TIERS ARE MUTUALLY EXCLUSIVE, and that is load-bearing rather than tidy.
 * Tiers 2 and 3 mint the same token shape — `subject_next {learnerId, subject,
 * continueToday: true}` — and resolution picks a single winner out of
 * `[...inProgress, ...available]`. If both printed, the "One more?" QR would
 * resolve to the catch-up lesson and its label would be a lie.
 *
 * TIER 1 SKIPS PROGRAM SUBJECTS. `CloseSessionOutcome` builds its projection
 * with no launchers, by design and by comment, so program sections in it carry
 * no daily status. Offering one would be a guess about whether piano was
 * already done today. A program subject is therefore never offered here; the
 * limitation is deliberate and documented in the spec (§4).
 */

/** The subject just passed is not its own "next subject". */
const isOfferableSection = (section, passedSubject) => (
  section
  && section.subject !== passedSubject
  && !section.servedToday
  && !!section.next
  && !section.next.program
);

/**
 * @param {object} args
 * @param {Array}  args.sections  agenda sections, already in fixed subject order
 * @param {string} args.subject   the subject whose lesson was just passed
 * @param {{unitId: string, title: string}|null} args.backlog
 *   an unfinished backlog lesson in `subject`, or null
 * @param {{unitId: string, title: string, description?: string|null,
 *          taxonomy?: object}|null} args.unlocked
 *   the next lesson this pass opened up in `subject`, or null
 * @returns {{tier: number, subject: string, continueToday: boolean,
 *            eyebrow: string, title: string, description: string,
 *            icon: string, unitId: string|null, taxonomy: object|null}|null}
 */
export function chooseForwardAction({ sections = [], subject, backlog = null, unlocked = null } = {}) {
  const tier1 = (Array.isArray(sections) ? sections : [])
    .find((section) => isOfferableSection(section, subject));
  if (tier1) {
    return {
      tier: 1,
      subject: tier1.subject,
      continueToday: false,
      eyebrow: 'Next up',
      title: tier1.next.title ?? tier1.next.unitId,
      description: `Still to do today: ${tier1.subject}.`,
      icon: tier1.subject,
      unitId: tier1.next.unitId ?? null,
      taxonomy: tier1.next.taxonomy ?? null,
    };
  }

  if (backlog) {
    return {
      tier: 2,
      subject,
      continueToday: true,
      eyebrow: 'Catch up',
      title: backlog.title ?? backlog.unitId,
      description: 'You still owe this one. Scan to catch up.',
      icon: subject,
      unitId: backlog.unitId ?? null,
      taxonomy: backlog.taxonomy ?? null,
    };
  }

  if (unlocked) {
    return {
      tier: 3,
      subject,
      continueToday: true,
      eyebrow: 'One more?',
      title: unlocked.title ?? unlocked.unitId,
      description: 'Today is already complete. Scan only if you want one more.',
      icon: subject,
      unitId: unlocked.unitId ?? null,
      taxonomy: unlocked.taxonomy ?? null,
    };
  }

  return null;
}

export default chooseForwardAction;
