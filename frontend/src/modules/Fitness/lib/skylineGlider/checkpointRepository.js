const key = (userId, courseId) => `fitness:skyline-glider:${userId}:${courseId}`;
const SCHEMA = 'skyline-glider-checkpoint/v2';
const courseId = (course) => typeof course === 'string' ? course : course?.id;

export function writeFlightCheckpoint(userId, course, checkpoint) {
  const id = courseId(course);
  if (!userId || !id || !Number.isInteger(course?.version)) return;
  localStorage.setItem(key(userId, id), JSON.stringify({
    schema: SCHEMA,
    course: { id, version: course.version },
    state: checkpoint,
  }));
}
export function readFlightCheckpoint(userId, course) {
  const id = courseId(course);
  try {
    const saved = JSON.parse(localStorage.getItem(key(userId, id))) || null;
    if (saved?.schema !== SCHEMA || saved.course?.id !== id || saved.course?.version !== course?.version) return null;
    return saved.state || null;
  } catch { return null; }
}
export function clearFlightCheckpoint(userId, course) {
  localStorage.removeItem(key(userId, courseId(course)));
}
