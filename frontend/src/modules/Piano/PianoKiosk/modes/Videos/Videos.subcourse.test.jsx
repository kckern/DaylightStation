import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let hookReturn;
vi.mock('./usePianoCoursePlayable.js', () => ({ usePianoCoursePlayable: () => hookReturn }));
vi.mock('../../PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser: 'kckern', currentProfile: {}, users: [] }) }));
vi.mock('./CourseDetail.jsx', () => ({ default: () => <div data-testid="flat">FLAT</div> }));
vi.mock('./SubcourseNavigator.jsx', () => ({ default: () => <div data-testid="nav">NAV</div> }));

import { CourseDetailRoute } from './Videos.jsx';

const renderRoute = () => render(
  <MemoryRouter initialEntries={['/676490']}>
    <Routes><Route path=":courseId" element={<CourseDetailRoute />} /></Routes>
  </MemoryRouter>,
);

describe('CourseDetailRoute branch', () => {
  beforeEach(() => { hookReturn = { items: null, info: {}, parents: null, isSequential: false, loading: true, error: null }; });

  it('renders the flat CourseDetail for a non-subcourses show', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: [] } };
    renderRoute();
    expect(screen.getByTestId('flat')).toBeTruthy();
  });

  it('renders the SubcourseNavigator when the show is labeled subcourses', () => {
    hookReturn = { ...hookReturn, loading: false, info: { type: 'show', labels: ['subcourses'] } };
    renderRoute();
    expect(screen.getByTestId('nav')).toBeTruthy();
  });
});
