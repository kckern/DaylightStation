import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import RepertoireBrowser from './RepertoireBrowser.jsx';

const item = (i, { course, style, skill, instructor, title }) => ({
  id: `plex:${i}`, plex: String(i), parentId: '900', itemIndex: i,
  title: title || course, label: title || course, image: `/t${i}.jpg`, duration: 200,
  piano: { course, styles: [style], skill, instructor },
});

const season = {
  id: '900', index: 0, title: 'Repertoire', reference: false, piano: { category: 'repertoire' },
  lessons: [
    item(101, { course: 'Clair de Lune', style: 'Classical', skill: 'Intermediate', instructor: 'Jonny' }),
    item(102, { course: 'Clair de Lune', style: 'Classical', skill: 'Intermediate', instructor: 'Jonny', title: 'Clair de Lune – Part 2' }),
    item(201, { course: 'Someone Like You', style: 'Pop', skill: 'Beginner', instructor: 'Sarah' }),
  ],
};

describe('RepertoireBrowser', () => {
  it('renders style/skill/instructor facet chips', () => {
    render(<RepertoireBrowser season={season} onPlay={vi.fn()} />);
    expect(screen.getByText('Classical')).toBeTruthy();
    expect(screen.getByText('Pop')).toBeTruthy();
    expect(screen.getByText('Intermediate')).toBeTruthy();
    expect(screen.getByText('Beginner')).toBeTruthy();
  });

  it('clicking a style chip filters the song list', () => {
    render(<RepertoireBrowser season={season} onPlay={vi.fn()} />);
    expect(screen.getByTitle('Clair de Lune')).toBeTruthy();
    expect(screen.getByTitle('Someone Like You')).toBeTruthy();
    fireEvent.click(screen.getByText('Classical'));
    expect(screen.getByTitle('Clair de Lune')).toBeTruthy();
    expect(screen.queryByTitle('Someone Like You')).toBeNull();
  });

  it('search filters by title', () => {
    render(<RepertoireBrowser season={season} onPlay={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search songs…'), { target: { value: 'someone' } });
    expect(screen.queryByTitle('Clair de Lune')).toBeNull();
    expect(screen.getByTitle('Someone Like You')).toBeTruthy();
  });

  it('tapping a song shows its lessons', () => {
    const onPlay = vi.fn();
    render(<RepertoireBrowser season={season} onPlay={onPlay} />);
    fireEvent.click(screen.getByTitle('Clair de Lune'));
    expect(screen.getByText('Clair de Lune – Part 2')).toBeTruthy();
    fireEvent.click(screen.getByText('Clair de Lune – Part 2').closest('button'));
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ plex: '102' }));
  });
});
