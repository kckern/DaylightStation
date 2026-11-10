// readingAudience.js
/** The living room's audience while a reading session is open: the credited child. */
export function readingAudience(session) {
  // A pick with no learner id falls through to the child at the reader.
  const who = session?.pick?.learner?.id ? session.pick.learner : (session?.learner ?? null);
  if (!who?.id) return null;
  return { activity: 'story', people: [{ id: String(who.id), name: who.name ?? null, role: 'learner', guest: false }] };
}
