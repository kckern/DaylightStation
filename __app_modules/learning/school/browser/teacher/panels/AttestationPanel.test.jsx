import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttestationPanel from "./AttestationPanel.jsx";
import { schoolApi } from "../../schoolApi.js";

vi.mock("../../schoolApi.js", () => ({
  schoolApi: {
    attestations: vi.fn(),
    curriculumUnits: vi.fn(),
    retract: vi.fn(),
    postAttestation: vi.fn(),
  },
}));

const TEACHERS = [{ id: 'teacher-a', name: 'Teacher A' }, { id: 'teacher-b', name: 'Teacher B' }];
vi.mock("../TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => ({ currentTeacher: { id: 'teacher-a', name: 'Teacher A' }, teachers: TEACHERS }),
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher-a', name: 'Teacher A' },
    teachers: TEACHERS,
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));

const ok = (data) => ({ ok: true, status: 200, data });

const ENTRY = {
  id: 'att_1', learnerId: 'learner-a', unitId: 'u1', reason: 'Did it on paper',
  attestedBy: 'teacher-b', at: '2026-09-01T10:00:00-07:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.attestations.mockResolvedValue(ok({ entries: [ENTRY] }));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [{ unitId: 'u1', title: 'Fractions' }] }));
  schoolApi.retract.mockResolvedValue(ok({}));
});

const mount = () => render(<AttestationPanel learnerId="learner-a" learnerName="Learner A" />);

describe('AttestationPanel', () => {
  it('names who attested by the roster name, not the raw id', async () => {
    mount();
    expect(await screen.findByText(/Teacher B/)).toBeInTheDocument();
    expect(screen.queryByText(/teacher-b/)).toBeNull();
  });
});
