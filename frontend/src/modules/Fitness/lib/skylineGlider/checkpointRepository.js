const key = (userId, courseId) => `fitness:skyline-glider:${userId}:${courseId}`;

export function writeFlightCheckpoint(userId, courseId, checkpoint) {
  if (!userId || !courseId) return;
  localStorage.setItem(key(userId, courseId), JSON.stringify(checkpoint));
}
export function readFlightCheckpoint(userId, courseId) {
  try { return JSON.parse(localStorage.getItem(key(userId, courseId))) || null; } catch { return null; }
}
export function clearFlightCheckpoint(userId, courseId) {
  localStorage.removeItem(key(userId, courseId));
}
