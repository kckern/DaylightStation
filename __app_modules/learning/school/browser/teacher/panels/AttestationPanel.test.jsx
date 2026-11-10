import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  // Retract un-unlocks the lesson after it, so it arms first: one tap offers
  // "Confirm retract" and Cancel, and only the confirm writes.
  it('one tap on Retract arms it and writes nothing', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retract' }));
    expect(screen.getByRole('button', { name: 'Confirm retract' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(schoolApi.retract).not.toHaveBeenCalled();
  });

  it('Cancel disarms without writing', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Retract' })).toBeInTheDocument();
    expect(schoolApi.retract).not.toHaveBeenCalled();
  });

  it('the confirm tap retracts as the claimed teacher', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retract' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm retract' }));
    await waitFor(() => expect(schoolApi.retract).toHaveBeenCalledWith({
      kind: 'attestation', entryId: 'att_1', retractedBy: 'teacher-a', pin: null,
    }));
  });
});
