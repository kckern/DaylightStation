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
    [curriculumPosterRef('selfservice', 'course-1'), '/api/v1/school/selfservice/curriculum/course-1/poster.jpg'],
    [streamRef('plex', '11'), '/api/v1/stream/plex/11'],
  ])('projects %o to the existing public URL', (ref, expected) => {
    expect(publicResourceUrl(ref)).toBe(expected);
  });

  it('preserves response keys and replaces nested refs only', () => {
    expect(presentPublicResources({ suggestions: [{ thumbnail: displayImageRef('plex', '11') }], total: 1 }))
      .toEqual({ suggestions: [{ thumbnail: '/api/v1/display/plex/11' }], total: 1 });
  });
});
