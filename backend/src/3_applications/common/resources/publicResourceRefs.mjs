/** Opaque public-resource references projected into URLs at an outer boundary. */
export const displayImageRef = (source, id) => ({ kind: 'display-image', source, id: String(id) });
export const contentImageRef = (source, id) => ({ kind: 'content-image', source, id: String(id) });
export const userAvatarRef = (userId) => ({ kind: 'user-avatar', userId: String(userId) });
export const feedbackItemRef = (app, id) => ({ kind: 'feedback-item', app: String(app), id: String(id) });
export const schoolArtifactRef = (artifactId, variant) => ({ kind: 'school-artifact', artifactId: String(artifactId), variant });
export const curriculumPosterRef = (scope, courseId) => ({ kind: 'curriculum-poster', scope, courseId: String(courseId) });
export const streamRef = (source, id) => ({ kind: 'content-stream', source: String(source), id: String(id) });
