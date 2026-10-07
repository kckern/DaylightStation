// What this Player last gave up on is a record with its own time. It stays in
// the session snapshot long enough for a sender to read it (the skip's
// replacement usually starts playing within a second), then the next
// successful "playing" retires it so a healthy screen stops reporting an old
// failure.
export const PROBLEM_CLEAR_GRACE_MS = 10_000;

export function problemClearedByPlaying(problem, now = Date.now()) {
  if (!problem) return false;
  const at = Number(problem.at);
  return !Number.isFinite(at) || now - at >= PROBLEM_CLEAR_GRACE_MS;
}
