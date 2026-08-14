/**
 * RecordTeacherNote — a note to a learner outside the review flow (spec
 * D3), delivered through the same surfaces resolved-review notes already
 * reach (student panel Feedback list, the agenda's "Notes for you").
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export class RecordTeacherNote {
  #notes; #teacherGate; #clock; #idGen; #logger;

  constructor({ notes, teacherGate, clock = () => new Date(), idGen = () => `note_${Math.random().toString(36).slice(2, 10)}`, logger = console } = {}) {
    if (!notes) throw new Error('RecordTeacherNote requires notes');
    if (!teacherGate) throw new Error('RecordTeacherNote requires teacherGate');
    this.#notes = notes;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#idGen = idGen;
    this.#logger = logger;
  }

  async execute({ learnerId, note, from = null, pin = null } = {}) {
    this.#teacherGate.assert({ userId: from, pin, action: 'note.send', context: { learnerId } });
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (typeof note !== 'string' || !note.trim()) throw new ValidationError('note is required');
    const entry = {
      id: this.#idGen(),
      at: this.#clock().toISOString(),
      from,
      learnerId,
      note: note.trim().slice(0, 240),
    };
    await this.#notes.append(entry);
    this.#logger.info?.('school.teacher-note.recorded', {
      learnerId, from, noteId: entry.id, length: entry.note.length,
    });
    return { entry };
  }
}
