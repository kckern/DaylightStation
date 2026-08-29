const segment = encodeURIComponent;

export function publicResourceUrl(ref) {
  switch (ref?.kind) {
    case 'display-image': return `/api/v1/display/${segment(ref.source)}/${segment(ref.id)}`;
    case 'content-image': return `/api/v1/content/${segment(ref.source)}/image/${segment(ref.id)}`;
    case 'user-avatar': return `/api/v1/static/users/${ref.userId}`;
    case 'feedback-item': return `/api/v1/feedback/${ref.app}/${ref.id}`;
    case 'school-artifact': return `/api/v1/school/teacher/artifacts/${segment(ref.artifactId)}/${ref.variant}`;
    case 'curriculum-poster': return `/api/v1/school/${ref.scope}/curriculum/${segment(ref.courseId)}/poster.jpg`;
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
