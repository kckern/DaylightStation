import { describe, expect, it } from 'vitest';
import {
  contentImageRef, curriculumPosterRef, displayImageRef, feedbackItemRef,
  schoolArtifactRef, streamRef, userAvatarRef,
} from '#apps/common/resources/publicResourceRefs.mjs';
import { presentPublicResources, publicResourceUrl } from './publicResourceRefs.mjs';

describe('public resource URL characterization', () => {
  it.each([
    [displayImageRef('plex', '11'), '/api/v1/display/plex/11'],
    [contentImageRef('plex', '9'), '/api/v1/content/plex/image/9'],
    [userAvatarRef('learner2'), '/api/v1/static/users/learner2'],
    [feedbackItemRef('fitness', '20260828120000_a1'), '/api/v1/feedback/fitness/20260828120000_a1'],
    [schoolArtifactRef('artifact/one', 'original.pdf'), '/api/v1/school/teacher/artifacts/artifact%2Fone/original.pdf'],
    [curriculumPosterRef('teacher', 'course/one'), '/api/v1/school/teacher/curriculum/course%2Fone/poster.jpg'],
    // `selfservice` is the SCOPE; `self-service` is where the router is
    // mounted. This line used to assert the scope spelling and so pinned a URL
    // that 404s — every agenda-planned lesson lost its poster, and the
    // characterization test called it correct. See the presenter's scope map.
    [curriculumPosterRef('selfservice', 'course-1'), '/api/v1/school/self-service/curriculum/course-1/poster.jpg'],
    [streamRef('plex', '11'), '/api/v1/stream/plex/11'],
  ])('projects %o to the existing public URL', (ref, expected) => {
    expect(publicResourceUrl(ref)).toBe(expected);
  });

  it('refuses a scope the presenter has no mount for, rather than minting a 404', () => {
    expect(() => curriculumPosterRef('self-service', 'course-1')).toThrow(/scope must be one of/);
    expect(() => curriculumPosterRef('nope', 'course-1')).toThrow(/scope must be one of/);
  });

  it('preserves response keys and replaces nested refs only', () => {
    expect(presentPublicResources({ suggestions: [{ thumbnail: displayImageRef('plex', '11') }], total: 1 }))
      .toEqual({ suggestions: [{ thumbnail: '/api/v1/display/plex/11' }], total: 1 });
  });
});
