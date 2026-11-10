import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ActiveOverrides from "./ActiveOverrides.jsx";
import { schoolApi } from "../../schoolApi.js";

vi.mock("../../schoolApi.js", () => ({
  schoolApi: {
    passOverrides: vi.fn(),
    attestations: vi.fn(),
    programDayBypasses: vi.fn(),
    curriculumUnits: vi.fn(),
  },
}));

vi.mock("../TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => ({
    currentTeacher: null,
    teachers: [{ id: 'teacher-a', name: 'Teacher A' }, { id: 'teacher-b', name: 'Teacher B' }, { id: 'teacher-c', name: 'Teacher C' }],
  }),
}));

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.passOverrides.mockResolvedValue(ok({ overrides: { u1: { percent: 60, setBy: 'teacher-a', at: '2026-09-01' } } }));
  schoolApi.attestations.mockResolvedValue(ok({ entries: [
    { id: 'att_1', learnerId: 'learner-a', unitId: 'u1', attestedBy: 'teacher-b', at: '2026-09-02' },
  ] }));
  schoolApi.programDayBypasses.mockResolvedValue(ok({ active: [
    { bypassId: 'pdb_1', learnerId: 'learner-a', programId: 'piano-course', decidedBy: 'teacher-c', decidedAt: '2026-09-03' },
  ] }));
  schoolApi.curriculumUnits.mockResolvedValue(ok({ units: [{ unitId: 'u1', title: 'Fractions' }] }));
});

describe('ActiveOverrides', () => {
  it('names who set each override by the roster name, not the raw id', async () => {
    render(<ActiveOverrides kids={[{ id: 'learner-a', name: 'Learner A' }]} />);
    expect(await within(await screen.findByTestId('active-pass-overrides')).findByText(/by Teacher A/)).toBeInTheDocument();
    expect(within(screen.getByTestId('active-attestations')).getByText(/by Teacher B/)).toBeInTheDocument();
    expect(within(screen.getByTestId('active-program-bypasses')).getByText(/by Teacher C/)).toBeInTheDocument();
    expect(screen.queryByText(/teacher-[abc]/)).toBeNull();
  });
});
