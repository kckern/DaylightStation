// pianoAudience.js
/** The piano tablet's audience: who is playing, and whether it is a game or the keyboard. */
export function pianoAudience(user, activity) {
  if (!user?.id) return null;
  const guest = user.id === 'guest';
  return { activity, people: [{ id: String(user.id), name: guest ? null : (user.name ?? null), role: 'player', guest }] };
}
