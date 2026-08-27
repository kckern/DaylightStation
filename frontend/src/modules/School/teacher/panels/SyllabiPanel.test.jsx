import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SyllabiPanel from './SyllabiPanel.jsx';
import { schoolApi } from '../../schoolApi.js';

vi.mock('../../schoolApi.js', () => ({
  schoolApi: {
    syllabi: vi.fn(),
    syllabus: vi.fn(),
    curriculumUnits: vi.fn(),
    putSyllabus: vi.fn(),
    archiveSyllabus: vi.fn(),
  },
}));

// A claimed, server-authorized teacher, so useTeacherWrite calls straight
// through without exposing or forwarding a PIN.
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));

const UNITS = [
  { unitId: 'caps.01', courseId: 'history-capitals', courseTitle: 'History Capitals' },
  { unitId: 'frac.01', courseId: 'math-fractions', courseTitle: 'Math Fractions' },
];

const FULL_SYLLABUS = {
  schema: 'school.syllabus/v1',
  syllabusId: 'atlas-upper',
  title: 'Atlas — upper',
  courseId: 'history-capitals',
  profile: 'upper',
  policy: { module_order: 'sequence' },
  passing: 80,
  term: 'fall-2026',
  // The two fields this panel must never touch.
  timingTemplate: { schema: 'school.timing-template/v1', defaultAnchorId: 'anchor-1', opensBeforeDays: 3 },
  schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
  updatedAt: '2026-08-01T00:00:00Z',
};

function mockCatalogAndSyllabi(syllabi) {
  schoolApi.curriculumUnits.mockResolvedValue({ ok: true, status: 200, data: { units: UNITS } });
  schoolApi.syllabi.mockResolvedValue({ ok: true, status: 200, data: { syllabi } });
}

describe('SyllabiPanel — list and empty state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders published syllabi with course, profile, and pass bar', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    expect(screen.getByText('History Capitals')).toBeInTheDocument();
    expect(screen.getByText('profile upper')).toBeInTheDocument();
    expect(screen.getByText('pass 80%')).toBeInTheDocument();
  });

  it('offers creation from the empty state', async () => {
    mockCatalogAndSyllabi([]);
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('No syllabi published yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add syllabus' })).toBeInTheDocument();
  });
});

describe('SyllabiPanel — the round-trip guarantee', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves timingTemplate and schedule UNCHANGED when only the title is edited', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    schoolApi.putSyllabus.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Atlas — upper (revised)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(schoolApi.putSyllabus).toHaveBeenCalled());
    const [id, body] = schoolApi.putSyllabus.mock.calls[0];
    expect(id).toBe('atlas-upper');
    expect(body.title).toBe('Atlas — upper (revised)');
    // The whole point of the test: two fields this panel never renders must
    // survive a save untouched, byte for byte.
    expect(body.timingTemplate).toEqual(FULL_SYLLABUS.timingTemplate);
    expect(body.schedule).toEqual(FULL_SYLLABUS.schedule);
    // `policy` IS an edited field (not a round-tripped one — see the field
    // vocabulary), but this save never touched the policy selects, so it
    // must come back exactly as it was seeded from the original record. This
    // pins the seed on SyllabusEditor's initial draft state
    // (`original.policy?.module_order ?? ''` etc.): remove that seed and the
    // draft starts blank, which would silently drop this on ANY save that
    // doesn't also re-pick every policy field.
    expect(body.policy).toEqual(FULL_SYLLABUS.policy);
    // Everything else this form does not edit also round-trips.
    expect(body.courseId).toBe('history-capitals');
    expect(body.profile).toBe('upper');
    expect(body.passing).toBe(80);
    expect(body.term).toBe('fall-2026');
  });
});

describe('SyllabiPanel — syllabusId settled-ness', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is editable when creating, and follows the title as a slug', async () => {
    mockCatalogAndSyllabi([]);
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add syllabus' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add syllabus' }));
    const idInput = screen.getByLabelText('Syllabus id');
    expect(idInput).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'World Capitals — Lower' } });
    expect(idInput.value).toBe('world-capitals-lower');
    // Hand-editing the id stops it from following the title further.
    fireEvent.change(idInput, { target: { value: 'custom-id' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'World Capitals — Lower Still' } });
    expect(idInput.value).toBe('custom-id');
  });

  it('is read-only when editing an existing syllabus', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const idInput = screen.getByLabelText('Syllabus id');
    expect(idInput).toBeDisabled();
    expect(idInput.value).toBe('atlas-upper');
  });
});

describe('SyllabiPanel — the create-id guard reaches archived syllabi', () => {
  beforeEach(() => vi.clearAllMocks());

  // `schoolApi.syllabi()` (the LIST) is already filtered to non-archived
  // records (YamlSyllabusStore.list()), so checking a new id against the
  // visible list alone would miss an archived syllabus holding that id —
  // and the PUT itself does an unconditional upsert with no existence check
  // of its own. `schoolApi.syllabus(id)` (the single-record GET) does NOT
  // filter archived, so a 200 there — even for an archived record — is the
  // collision this guard must catch.
  it('refuses to create over an id an archived syllabus still holds', async () => {
    mockCatalogAndSyllabi([]); // the list is empty — the archived record is invisible here
    schoolApi.syllabus.mockResolvedValue({
      ok: true, status: 200, data: { ...FULL_SYLLABUS, archivedAt: '2026-01-01T00:00:00Z' },
    });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add syllabus' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add syllabus' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Atlas' } });
    fireEvent.change(screen.getByLabelText('Syllabus id'), { target: { value: 'atlas-upper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(schoolApi.syllabus).toHaveBeenCalledWith('atlas-upper'));
    expect(await screen.findByText('"atlas-upper" is already in use — pick a different id.')).toBeInTheDocument();
    expect(schoolApi.putSyllabus).not.toHaveBeenCalled();
  });

  it('creates once the id-existence check comes back 404 (free)', async () => {
    mockCatalogAndSyllabi([]);
    schoolApi.syllabus.mockResolvedValue({ ok: false, status: 404, data: null });
    schoolApi.putSyllabus.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add syllabus' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add syllabus' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'World Capitals' } });
    fireEvent.change(screen.getByLabelText('Course'), { target: { value: 'history-capitals' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(schoolApi.syllabus).toHaveBeenCalledWith('world-capitals'));
    await waitFor(() => expect(schoolApi.putSyllabus).toHaveBeenCalled());
    expect(schoolApi.putSyllabus.mock.calls[0][0]).toBe('world-capitals');
  });
});

describe('SyllabiPanel — archive requires the second tap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call archiveSyllabus on the first tap, and does on Confirm', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    schoolApi.archiveSyllabus.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(schoolApi.archiveSyllabus).not.toHaveBeenCalled();
    expect(screen.getByText(/materialize no new enrollments/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(schoolApi.archiveSyllabus).toHaveBeenCalledWith('atlas-upper', {
      archivedBy: 'kckern', pin: null,
    }));
  });

  it('Cancel disarms without calling the api', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(schoolApi.archiveSyllabus).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});

describe('SyllabiPanel — server validation is surfaced, not swallowed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a named validation error from the server rather than a generic failure', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    schoolApi.putSyllabus.mockResolvedValue({
      ok: false, status: 400, data: { error: "unknown profile: 'ghost' is not offered by history-capitals" },
    });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Profile'), { target: { value: 'ghost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("unknown profile: 'ghost' is not offered by history-capitals")).toBeInTheDocument();
  });
});

describe('SyllabiPanel — the passing blank-guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves an untouched pass field alone rather than clearing it', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    schoolApi.putSyllabus.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Clear the field by hand (simulating a stray edit-then-undo) without
    // checking "use course default" — save must still carry the real value.
    fireEvent.change(screen.getByLabelText('Pass bar'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(schoolApi.putSyllabus).toHaveBeenCalled());
    expect(schoolApi.putSyllabus.mock.calls[0][1].passing).toBe(80);
  });

  it('clears the pass bar only via the explicit checkbox', async () => {
    mockCatalogAndSyllabi([FULL_SYLLABUS]);
    schoolApi.putSyllabus.mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<SyllabiPanel />);
    await waitFor(() => expect(screen.getByText('Atlas — upper')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByLabelText('Use the course default pass bar'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(schoolApi.putSyllabus).toHaveBeenCalled());
    expect(schoolApi.putSyllabus.mock.calls[0][1].passing).toBeNull();
  });
});
