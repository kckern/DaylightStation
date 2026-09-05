const segment = encodeURIComponent;

/**
 * A curriculum poster's scope names WHICH ROUTER serves it, and the router's
 * mount path is not the same string as the scope.
 *
 * This used to interpolate `ref.scope` straight into the path. `teacher` is
 * mounted at `/teacher` so it worked; `selfservice` is mounted at
 * `/self-service`, so every poster the AGENDA emitted resolved to
 * `/api/v1/school/selfservice/curriculum/<id>/poster.jpg` — a 404, on every
 * planned lesson, forever. The only posters anyone ever saw were the ones on
 * rows that happened to have a session (teacher scope). An `<img>` that 404s
 * shows nothing and says nothing, so the whole thing read as "we just don't
 * have posters for those".
 *
 * A CLOSED MAP, not a template: an unrecognised scope must be a null ref the
 * caller can see, never a plausible-looking URL that quietly 404s.
 */
const CURRICULUM_POSTER_MOUNTS = Object.freeze({
  teacher: 'teacher',
  selfservice: 'self-service',
});

export function publicResourceUrl(ref) {
  switch (ref?.kind) {
    case 'display-image': return `/api/v1/display/${segment(ref.source)}/${segment(ref.id)}`;
    case 'content-image': return `/api/v1/content/${segment(ref.source)}/image/${segment(ref.id)}`;
    case 'user-avatar': return `/api/v1/static/users/${ref.userId}`;
    case 'feedback-item': return `/api/v1/feedback/${ref.app}/${ref.id}`;
    case 'school-artifact': return `/api/v1/school/teacher/artifacts/${segment(ref.artifactId)}/${ref.variant}`;
    case 'curriculum-poster': {
      const mount = CURRICULUM_POSTER_MOUNTS[ref.scope];
      return mount ? `/api/v1/school/${mount}/curriculum/${segment(ref.courseId)}/poster.jpg` : null;
    }
    case 'content-stream': return `/api/v1/stream/${segment(ref.source)}/${segment(ref.id)}`;
    case 'stream-proxy': {
      const query = new URLSearchParams({ src: ref.sourceUrl });
      if (ref.profile) query.set('profile', ref.profile);
      return `/api/v1/proxy/stream?${query.toString()}`;
    }
    default: return null;
  }
}

/** Recursively project only recognized references, preserving every envelope key. */
export function presentPublicResources(value) {
  if (Array.isArray(value)) return value.map(presentPublicResources);
  if (!value || typeof value !== 'object') return value;
  const url = publicResourceUrl(value);
  if (url !== null) return url;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, presentPublicResources(child)]));
}
