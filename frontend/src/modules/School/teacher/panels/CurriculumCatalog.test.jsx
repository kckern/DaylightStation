import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CurriculumCatalog, { passSummary } from './CurriculumCatalog.jsx';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: { curriculumUnits: vi.fn(), passOverrides: vi.fn() },
}));
vi.mock('../../Programs/SentenceLadder/languageApi.js', () => ({
  languageApi: { courses: vi.fn(async () => ({ ok: true, status: 200, data: [] })) },
}));
import { schoolApi } from '../../schoolApi.js';

const unitsFor = (courseId, courseTitle, count) => Array.from({ length: count }, (_, i) => ({
  unitId: `${courseId}-u${i}`, courseId, courseTitle, title: `Lesson ${i}`, sequence: i, passingPercent: 80,
}));

describe('CurriculumCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolApi.passOverrides.mockResolvedValue({ ok: true, status: 200, data: { overrides: { 'atlas-u1': 85 } } });
  });

  it('renders one card per course — never a per-lesson row or Set form', async () => {
    schoolApi.curriculumUnits.mockResolvedValue({ ok: true, status: 200, data: { units: [
      ...unitsFor('atlas', 'Atlas of the US', 40),
      ...unitsFor('math', 'Big Fat Notebook: Math', 38),
      { unitId: 'solo-1', courseId: null, title: 'Standalone thing', passingPercent: null },
    ] } });
    render(<CurriculumCatalog />);
    await waitFor(() => expect(screen.getByTestId('curriculum-catalog')).toBeInTheDocument());
    expect(screen.getByText('Atlas of the US')).toBeInTheDocument();
    expect(screen.getByText(/40 lessons · pass 80% · 1 override/)).toBeInTheDocument();
    expect(screen.getByText(/38 lessons · pass 80%$/)).toBeInTheDocument();
    expect(screen.getByText('Standalone lessons')).toBeInTheDocument();
    // No per-lesson rendering on the catalog.
    expect(screen.queryByText('Lesson 5')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set' })).toBeNull();
    // Card links to the drill-in route.
    expect(screen.getByRole('link', { name: /Atlas of the US/ }).getAttribute('href')).toBe('/school/teacher/curriculum/atlas');
  });

  it('passSummary reports the modal bar and override count', () => {
    const units = unitsFor('c', 'C', 3);
    expect(passSummary(units, {})).toBe('pass 80%');
    expect(passSummary(units, { 'c-u0': 90 })).toBe('pass 80% · 1 override');
    expect(passSummary([{ unitId: 'x', passingPercent: null }], {})).toBe('no pass bar');
  });
});
