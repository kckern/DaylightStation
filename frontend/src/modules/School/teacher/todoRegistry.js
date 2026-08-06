/**
 * The skeleton's TODO contract (teacher-console spec §4.6): every StubCard in
 * the console carries one of these ids, and every id renders exactly once —
 * the spec's placeholder-registry table and this file must stay in lockstep
 * (a stub with no registry row, or a row with no stub, is a review failure;
 * TeacherConsole.test.jsx enforces the UI side).
 */
export const TODO = {
  ATTESTATION: 'teacher.attestation',
  REASSIGN: 'teacher.reassign',
  NOTES_STANDALONE: 'teacher.notes.standalone',
};

/** Card copy per stub — what will live there, in the teacher's language. */
export const STUB_COPY = {
  [TODO.ATTESTATION]: {
    title: 'Attestation override',
    body: 'When the Portal, calculator, or bubble sheets fail, record "I verify this was done" as its own evidence — never a silent edit.',
  },
  [TODO.REASSIGN]: {
    title: 'Attribution repair',
    body: 'Move a mis-attributed sitting’s evidence from one child to another.',
  },
  [TODO.NOTES_STANDALONE]: {
    title: 'Write a note',
    body: 'Send a note to a learner outside the review flow — it reaches their agenda and receipts the same way.',
  },
};

export default TODO;
