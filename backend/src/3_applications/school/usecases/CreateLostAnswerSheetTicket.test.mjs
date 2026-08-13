import { describe, it, expect, vi } from 'vitest';
import { CreateLostAnswerSheetTicket } from './CreateLostAnswerSheetTicket.mjs';

describe('CreateLostAnswerSheetTicket', () => {
  it('authorizes, persists, and returns a short-lived scannable receipt document', async () => {
    const tokens = { put: vi.fn(async () => {}) };
    const teacherGate = { assert: vi.fn() };
    const useCase = new CreateLostAnswerSheetTicket({
      tokens, teacherGate,
      clock: () => new Date('2026-08-13T12:00:00.000Z'), rng: () => 0, ttlMinutes: 15,
    });
    const result = await useCase.execute({ cardId: '1234567', requestedBy: 'kckern', pin: '4321' });
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'answer-sheet.lost-ticket', userId: 'kckern', pin: '4321',
    }));
    expect(result).toMatchObject({
      status: 'issued', cardId: '1234567', expiresAt: '2026-08-13T12:15:00.000Z',
    });
    expect(result.code).toMatch(/^sch:/);
    expect(result.document.blocks).toContainEqual(expect.objectContaining({
      type: 'scan_action', action: result.code, label: 'Replace lost answer sheet',
    }));
    expect(tokens.put).toHaveBeenCalledWith(expect.objectContaining({
      tokenClass: 'answer_sheet_lost', subject: { cardId: '1234567', authorizedBy: 'kckern' },
    }));
  });
});
