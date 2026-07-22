/**
 * The School program registry — what programs exist and how to open one.
 *
 * Modelled on the Piano kiosk's `PIANO_MODES`, with one structural difference
 * that matters. Piano's modes are ten fixed peers: the list IS the menu. School's
 * are not, because a program has INSTANCES that come from data — a learner may
 * study two languages, and the Plex catalogue decides how many course categories
 * exist. So the registry declares the fixed part (which programs exist, what
 * they are called, how to route into one) and the report supplies the rest.
 *
 * This is the missing link between the report contract and navigation. A report
 * says `program: 'language', instanceId: 'glossika-korean'` and can describe
 * what is next; only this file knows that opening it means the `lang:` section.
 * Keeping that here rather than in the contract is deliberate: routing is a
 * frontend concern and the domain should not learn about it.
 *
 * `available: false` marks a program that is specced but not built. It is shown
 * greyed rather than hidden — the same call Piano makes for Producer — so the
 * shape of the whole programme is visible instead of the home pretending that
 * what exists is all there is.
 */

export const PROGRAMS = {
  language: {
    label: 'Language',
    blurb: 'Sentences to hear, say and write',
    available: true,
    sectionFor: (report) => (report?.instanceId ? `lang:${report.instanceId}` : null),
  },
  quizzes: {
    label: 'Quizzes & Flashcards',
    blurb: 'Practice sets and tests',
    available: true,
    sectionFor: () => 'banks',
  },
  materials: {
    label: 'Courses',
    blurb: 'Watch, listen, and pass the quiz',
    available: true,
    sectionFor: (report) => (report?.instanceId ? `cat:${report.instanceId}` : null),
  },
  writing: {
    label: 'Writing',
    blurb: 'Coming soon',
    available: false,
    sectionFor: () => null,
  },
  typing: {
    label: 'Typing',
    blurb: 'Coming soon',
    available: false,
    sectionFor: () => null,
  },
};

/**
 * The section id that opens what a report describes, or null if it cannot be
 * opened.
 *
 * Returns null rather than guessing for an unknown program: a wrong route puts
 * a learner somewhere they did not ask to be, which is worse than a card that
 * simply is not tappable. Callers render the card without an action.
 */
export function sectionForReport(report) {
  const program = PROGRAMS[report?.program];
  if (!program || !program.available) return null;
  return program.sectionFor(report) ?? null;
}

export function programLabel(id) {
  return PROGRAMS[id]?.label ?? id;
}

export default PROGRAMS;
