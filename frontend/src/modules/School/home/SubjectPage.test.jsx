import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubjectPage from './SubjectPage.jsx';

// Same mock shapes as MaterialsSection.renderprop.test.jsx (materials/) — this
// test renders the REAL MaterialsSection (via the real SubjectPage) so opening
// a detail genuinely replaces the catalog; only the network-backed leaves are
// stubbed.
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    materialUnits: vi.fn(async () => ({ ok: true, status: 200, data: { units: [] } })),
    quizRequests: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
  },
}));

vi.mock('../materials/SchoolMaterialPlayer.jsx', () => ({
  default: () => <div data-testid="player-stub" />,
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

vi.mock('../SchoolBreadcrumbContext.jsx', () => ({
  useSchoolBreadcrumb: () => {},
}));

const shelf = {
  materials: [
    { id: 'plex:v1', title: 'Big History', medium: 'video', category: 'course' },
    { id: 'plex:a1', title: 'I Survived', medium: 'audio', category: 'listening' },
  ],
  banks: [{ id: 'b1', title: 'US States', itemCount: 10, audience: 'generic' }],
  courses: [{ id: 'glossika-korean', label: 'Glossika Korean' }],
};

beforeEach(() => {
  profile = { currentUser: { id: 'felix', name: 'Felix' }, isGuest: false, openPicker: vi.fn() };
});

describe('SubjectPage', () => {
  it('renders grouped KindSections (Watch/Listen/Apps/Practice) with the mixed shelf items', () => {
    render(
      <SubjectPage
        subjectId="writing"
        shelf={shelf}
        onLaunch={vi.fn()}
        onOpen={vi.fn()}
        onMaterialNav={vi.fn()}
      />
    );
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Listen')).toBeInTheDocument();
    expect(screen.getByText('Apps')).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();

    // Video/audio tiles without a poster render a text placeholder AND the
    // clamped title, so the title text appears twice — assert presence, not
    // uniqueness.
    expect(screen.getAllByText('Big History').length).toBeGreaterThan(0);
    expect(screen.getAllByText('I Survived').length).toBeGreaterThan(0);
    expect(screen.getByText('US States')).toBeInTheDocument();
    // writing's built-in program (typing) plus the language course, both Apps.
    expect(screen.getByText('Typing')).toBeInTheDocument();
    expect(screen.getByText('Glossika Korean')).toBeInTheDocument();
  });

  it('hides the subject-level Apps/Practice sections once a material detail is open (the hierarchy fix)', async () => {
    render(
      <SubjectPage
        subjectId="writing"
        shelf={shelf}
        onLaunch={vi.fn()}
        onOpen={vi.fn()}
        onMaterialNav={vi.fn()}
        initialMaterialPath={['plex:v1']}
      />
    );
    // The detail replaced the catalog — wait for MaterialDetail's async fetch.
    await screen.findByText('No units yet.');
    expect(screen.queryByText('Apps')).not.toBeInTheDocument();
    expect(screen.queryByText('Practice')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch')).not.toBeInTheDocument();
    expect(screen.queryByText('Listen')).not.toBeInTheDocument();
  });

  it('renders "Nothing on this shelf yet." for a wholly empty shelf with no program', () => {
    render(
      <SubjectPage
        subjectId="math"
        shelf={{ materials: [], banks: [], courses: [] }}
        onLaunch={vi.fn()}
        onOpen={vi.fn()}
        onMaterialNav={vi.fn()}
      />
    );
    expect(screen.getByText('Nothing on this shelf yet.')).toBeInTheDocument();
  });
});
