import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EnrichmentPanel from "./EnrichmentPanel.jsx";
import { schoolApi } from "../../schoolApi.js";

vi.mock("../../schoolApi.js", () => ({
  schoolApi: {
    enrichment: vi.fn(),
    postEnrichment: vi.fn(),
    retract: vi.fn(),
  },
}));

vi.mock("../TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => ({ currentTeacher: { id: 'teacher-a', name: 'Teacher A' }, teachers: [] }),
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher-a', name: 'Teacher A' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));

const KIDS = [{ id: 'learner-a', name: 'Learner A' }, { id: 'learner-b', name: 'Learner B' }];

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.enrichment.mockResolvedValue({ ok: true, status: 200, data: { entries: [
    { id: 'en_1', title: 'Museum trip', from: '2026-09-01', learnerIds: ['learner-a', 'learner-b'], subjectIds: [] },
  ] } });
});

describe('EnrichmentPanel', () => {
  it('lists who an entry covers by name, not by learner id', async () => {
    render(<EnrichmentPanel kids={KIDS} />);
    expect(await screen.findByText(/Learner A, Learner B/)).toBeInTheDocument();
    expect(screen.queryByText(/learner-a/)).toBeNull();
  });
});
