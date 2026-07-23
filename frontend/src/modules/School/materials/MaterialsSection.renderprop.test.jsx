import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaterialsSection from './MaterialsSection.jsx';

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    materialUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [] } })),
  },
}));

vi.mock('./SchoolMaterialPlayer.jsx', () => ({
  default: () => <div data-testid="player-stub" />,
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

vi.mock('../SchoolBreadcrumbContext.jsx', () => ({
  useSchoolBreadcrumb: () => {},
}));

// Kept as a simple stub (per the brief) so the "detail replaces the shelf"
// assertion focuses on MaterialsSection's branch swap, not MaterialDetail's
// own fetch/render behavior (already covered by MaterialDetail.test.jsx).
vi.mock('./MaterialDetail.jsx', () => ({
  default: ({ material }) => <div data-testid="detail-stub">{material.title}</div>,
}));

const materials = [
  { id: 'plex:1', title: 'Bill Nye', category: 'course' },
  { id: 'plex:2', title: 'Magic School Bus', category: 'course' },
];

beforeEach(() => {
  profile = { currentUser: { id: 'felix', name: 'Felix' }, isGuest: false, openPicker: vi.fn() };
});

describe('MaterialsSection renderCatalog seam', () => {
  it('renderCatalog is used at the grid level, replacing the default MaterialGrid', () => {
    render(
      <MaterialsSection
        materials={materials}
        sectionLabel="Courses"
        renderCatalog={({ onSelect }) => <button type="button" onClick={() => onSelect(materials[0])}>CUSTOM</button>}
      />
    );
    expect(screen.getByText('CUSTOM')).toBeInTheDocument();
    // The default MaterialGrid tiles (rendered by material title) must NOT
    // also be present -- renderCatalog REPLACES the grid, it doesn't add to it.
    expect(screen.queryByText('Bill Nye')).toBeNull();
    expect(screen.queryByText('Magic School Bus')).toBeNull();
  });

  it('opening a detail replaces the catalog entirely (the hierarchy fix: shelf swapped out, not stacked)', async () => {
    render(
      <MaterialsSection
        materials={materials}
        sectionLabel="Courses"
        initialMaterialPath={['plex:1']}
        renderCatalog={({ onSelect }) => <button type="button" onClick={() => onSelect(materials[0])}>CUSTOM</button>}
      />
    );
    expect(await screen.findByTestId('detail-stub')).toBeInTheDocument();
    expect(screen.queryByText('CUSTOM')).toBeNull();
  });
});
