/** Opaque public-resource references projected into URLs at an outer boundary. */
export const displayImageRef = (source, id) => ({ kind: 'display-image', source, id: String(id) });
export const contentImageRef = (source, id) => ({ kind: 'content-image', source, id: String(id) });
export const userAvatarRef = (userId) => ({ kind: 'user-avatar', userId: String(userId) });
export const feedbackItemRef = (app, id) => ({ kind: 'feedback-item', app: String(app), id: String(id) });
export const schoolArtifactRef = (artifactId, variant) => ({ kind: 'school-artifact', artifactId: String(artifactId), variant });
/**
 * Which router serves this poster. Validated HERE, at construction, because
 * the presenter's scope→mount map is closed: a scope it does not know cannot
 * be turned into a URL, and the failure would otherwise surface as an `<img>`
 * that 404s silently on a child's or a teacher's screen. A typo should stop a
 * test, not a poster.
 */
export const CURRICULUM_POSTER_SCOPES = Object.freeze(['teacher', 'selfservice']);

export const curriculumPosterRef = (scope, courseId) => {
  if (!CURRICULUM_POSTER_SCOPES.includes(scope)) {
    throw new Error(`curriculumPosterRef: scope must be one of ${CURRICULUM_POSTER_SCOPES.join('|')}, got: ${scope}`);
  }
  return { kind: 'curriculum-poster', scope, courseId: String(courseId) };
};
export const streamRef = (source, id) => ({ kind: 'content-stream', source: String(source), id: String(id) });
