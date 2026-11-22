import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import WorkCard from './WorkCard.jsx';
import WorkImage from './WorkImage.jsx';

const base = {
  type: 'school', id: 'school:kid-a:book:wonder:2026-04-21',
  learnerId: 'kid-a', learnerName: 'Mara', kind: 'book', verb: 'finished',
  title: 'Wonder', subtitle: 'R. J. Palacio', at: '2026-04-21T22:00:00Z', takenAt: '2026-04-21T22:00:00Z',
  studyDay: '2026-04-21', imageUrl: null, groupKey: 'book:wonder', weight: 3, subject: 'reading',
};

const verbOf = (item) => {
  const { container } = render(<WorkCard item={item} index={0} total={2} color="#2f6fde" />);
  return container.querySelector('.work-card-verb').textContent;
};

describe('WorkCard', () => {
  it('names the child, the work and its subtitle', () => {
    render(<WorkCard item={base} index={1} total={4} color="#2f6fde" />);
    expect(screen.getByText('Mara')).toBeInTheDocument();
    expect(screen.getAllByText('Wonder').length).toBeGreaterThan(0);
    expect(screen.getByText('R. J. Palacio')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
  });

  it('carries the child hue as --kid', () => {
    const { container } = render(<WorkCard item={base} index={0} total={1} color="#2f6fde" />);
    expect(container.querySelector('.weekly-review-work-card').style.getPropertyValue('--kid')).toBe('#2f6fde');
  });

  it('labels each verb', () => {
    expect(verbOf(base)).toBe('Finished');
    expect(verbOf({ ...base, verb: 'started' })).toBe('Started');
    expect(verbOf({ ...base, kind: 'activity', verb: 'completed' })).toBe('Completed');
    expect(verbOf({ ...base, kind: 'course', verb: 'worked' })).toBe('Worked on');
    expect(verbOf({ ...base, kind: 'program', verb: 'worked' })).toBe('Practiced');
  });

  it('names the weekday of the study day and no clock time', () => {
    const { container } = render(<WorkCard item={{ ...base, studyDay: '2026-11-21', at: '2026-11-21T12:00:00Z' }} index={0} total={1} />);
    expect(container.querySelector('.work-card-when').textContent).toBe('Saturday');
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  it('pins the work image when there is one', () => {
    const { container } = render(<WorkCard item={{ ...base, imageUrl: '/api/work.jpg' }} index={0} total={1} />);
    expect(container.querySelector('img.work-print-img').getAttribute('src')).toBe('/api/work.jpg');
    expect(container.querySelector('.work-print-card')).toBeNull();
  });

  it('falls back to a title card when there is no image', () => {
    const { container } = render(<WorkCard item={base} index={0} total={1} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.work-print-card .work-print-glyph').textContent).toBe('📕');
    expect(container.querySelector('.work-print-card .work-print-title').textContent).toBe('Wonder');
  });

  it('falls back to the title card when the image fails to load', () => {
    const { container } = render(<WorkCard item={{ ...base, kind: 'activity', subject: 'activity', imageUrl: '/broken.jpg' }} index={0} total={1} />);
    fireEvent.error(container.querySelector('img.work-print-img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.work-print-glyph').textContent).toBe('🧩');
  });

  it('uses the pencil for an unknown subject', () => {
    const { container } = render(<WorkCard item={{ ...base, subject: 'math' }} index={0} total={1} />);
    expect(container.querySelector('.work-print-glyph').textContent).toBe('✏️');
  });

  it('never shows a score, even when one sneaks into the item', () => {
    const { container } = render(<WorkCard item={{ ...base, gradedPercent: 87, score: 87 }} index={0} total={1} />);
    expect(container.textContent).not.toMatch(/%/);
    expect(container.textContent).not.toMatch(/87/);
  });

  it('leaves the verb out for a verb it does not know', () => {
    const { container } = render(<WorkCard item={{ ...base, verb: 'graded' }} index={0} total={1} />);
    expect(container.querySelector('.work-card-verb')).toBeNull();
  });

  it('gives the pinned image an empty alt, since the title is written beside it', () => {
    const { container } = render(<WorkCard item={{ ...base, imageUrl: '/api/work.jpg' }} index={0} total={1} />);
    expect(container.querySelector('img.work-print-img').getAttribute('alt')).toBe('');
  });
});

describe('WorkImage', () => {
  it('uses the work title as alt by default', () => {
    const { container } = render(<WorkImage item={{ ...base, imageUrl: '/api/work.jpg' }} />);
    expect(container.querySelector('img').getAttribute('alt')).toBe('Wonder');
  });
});
