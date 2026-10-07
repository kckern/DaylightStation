const key = (userId, courseId) => `fitness:skyline-glider:${userId}:${courseId}`;
const SCHEMA = 'skyline-glider-checkpoint/v3';
const courseId = (course) => typeof course === 'string' ? course : course?.id;

export function writeFlightCheckpoint(userId, course, checkpoint) {
  const id = courseId(course);
  if (!userId || !id || !Number.isInteger(course?.version)) return;
  localStorage.setItem(key(userId, id), JSON.stringify({
    schema: SCHEMA,
    course: { id, version: course.version },
    lifecycle: checkpoint.lifecycle || 'active',
    identity: checkpoint.identity,
    state: checkpoint.state,
    ...(checkpoint.terminalRecord ? { terminalRecord: checkpoint.terminalRecord } : {}),
  }));
}
const sameCalibration = (left, right) => left?.lowRpm === right?.lowRpm && left?.highRpm === right?.highRpm;

export function readFlightCheckpoint(userId, course, expectedIdentity = {}) {
  const id = courseId(course);
  try {
    const raw = localStorage.getItem(key(userId, id));
    if (!raw) return { status: 'missing' };
    const saved = JSON.parse(raw);
    if (saved?.schema !== SCHEMA) return { status: 'incompatible', reason: 'legacy-schema' };
    if (saved.course?.id !== id || saved.course?.version !== course?.version) return { status: 'incompatible', reason: 'course-identity' };
    if (!saved.identity || !saved.state) return { status: 'invalid', reason: 'missing-payload' };
    if (saved.lifecycle === 'pending_terminal') return { status: 'pending_terminal', identity: saved.identity, state: saved.state, terminalRecord: saved.terminalRecord };
    const fields = ['fitnessSessionId', 'riderId', 'equipmentId', 'runId', 'startedAt'];
    const mismatched = fields.find((field) => expectedIdentity[field] != null && saved.identity[field] !== expectedIdentity[field]);
    if (mismatched || (expectedIdentity.calibration && !sameCalibration(saved.identity.calibration, expectedIdentity.calibration))) {
      return { status: 'incompatible', reason: mismatched || 'calibration' };
    }
    if (saved.lifecycle !== 'active') return { status: 'invalid', reason: 'lifecycle' };
    return { status: 'compatible', identity: saved.identity, state: saved.state };
  } catch { return { status: 'invalid', reason: 'parse' }; }
}
export function clearFlightCheckpoint(userId, course) {
  localStorage.removeItem(key(userId, courseId(course)));
}
