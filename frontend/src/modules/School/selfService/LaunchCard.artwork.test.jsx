/**
 * Where the launch card looks for a course's artwork.
 *
 * The incident these cover: a `plex:`-backed course (the piano course) had no
 * poster in the curriculum package, the route answered a GENERATED gradient at
 * HTTP 200, and a child stood in front of an invented poster. So the two things
 * asserted here are (1) a `plex:` id resolves against the Plex image proxy the
 * rest of the house already uses, and (2) anything that fails to load falls
 * back to the card's own blank placeholder — never to a substitute image.
 *
 * NOTE: jsdom sees structure, not layout. These tests say nothing about how the
 * card LOOKS; the poster's alignment, type scale and hierarchy need a browser.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LaunchCard from './LaunchCard.jsx';

const cardFor = (course) => ({
  schema: 'school.self-service-card/v2',
  ok: true,
  context: {
    learner: { id: 'kid1', displayName: 'Alpha', avatar: { kind: 'learner', id: 'kid1' } },
    taxonomy: {
      subject: { id: 'arts', label: 'Arts & Culture' },
      course,
      module: { id: 'season-4', title: 'Unit 4' },
      lesson: { id: 'plex:9003', title: 'Lesson 3' },
    },
    trail: [
      { kind: 'subject', id: 'arts', label: 'Arts & Culture' },
      { kind: 'course', id: course?.id ?? 'x', label: course?.title ?? 'x' },
    ],
    progress: [],
  },
  presentation: { status: 'ready', message: null },
  actions: [{ kind: 'program', label: 'Start the lesson', role: 'primary' }],
});

const noop = () => {};
const renderCard = (course) => render(
  <LaunchCard card={cardFor(course)} onAction={noop} onConfirm={noop} onExit={noop} />,
);

describe('LaunchCard course artwork', () => {
  it('resolves a plex-backed course against the Plex image proxy, sized to the box', () => {
    renderCard({
      id: 'plex:675689',
      title: 'Hoffman Academy',
      artwork: { kind: 'course-poster', courseId: 'plex:675689' },
    });

    const img = screen.getByRole('img', { name: 'Hoffman Academy cover' });
    const src = img.getAttribute('src');
    // Goes through the shared proxy transcode, carrying the real ratingKey —
    // never the curriculum route, which cannot serve a Plex-hosted cover.
    expect(src).toContain('/api/v1/proxy/plex/photo/:/transcode');
    expect(decodeURIComponent(src)).toContain('/library/metadata/675689/thumb');
    expect(src).not.toContain('/self-service/curriculum/');
  });

  it('asks the curriculum route for a course whose poster ships in its package', () => {
    renderCard({
      id: 'fractions',
      title: 'Fractions',
      artwork: { kind: 'course-poster', courseId: 'fractions' },
    });

    expect(screen.getByRole('img', { name: 'Fractions cover' }))
      .toHaveAttribute('src', '/api/v1/school/self-service/curriculum/fractions/poster.jpg');
  });

  it('falls back to the blank placeholder — not a substitute image — when artwork fails to load', () => {
    renderCard({
      id: 'fractions',
      title: 'Fractions',
      artwork: { kind: 'course-poster', courseId: 'fractions' },
    });

    fireEvent.error(screen.getByRole('img', { name: 'Fractions cover' }));

    expect(screen.queryByRole('img', { name: 'Fractions cover' })).toBeNull();
    expect(document.querySelector('.school-selfservice-card__poster-placeholder')).not.toBeNull();
  });

  it('draws the placeholder for a course that carries no artwork reference at all', () => {
    renderCard(null);

    expect(document.querySelector('.school-selfservice-card__poster-placeholder'))
      .toHaveAttribute('aria-label', 'Arts & Culture artwork');
  });
});
