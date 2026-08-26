import { describe, expect, it } from 'vitest';
import { ListPrintableWorksheetSessions } from './ListPrintableWorksheetSessions.mjs';

describe('ListPrintableWorksheetSessions', () => {
  it('offers only issuable bank-only sessions from the requested day window', async () => {
    const listLearnerSessions = {
      async execute(args) {
        expect(args).toEqual({ learnerId: 'learner3', window: 'today' });
        return [
          { sessionId: 'paper', unitId: 'science/paper', state: 'created' },
          { sessionId: 'video', unitId: 'science/video', state: 'created' },
          { sessionId: 'done', unitId: 'science/paper', state: 'graded' },
          { sessionId: 'missing', unitId: 'science/missing', state: 'created' },
        ];
      },
    };
    const curriculum = {
      async getUnit(id) {
        if (id === 'science/paper') return {
          unitId: id, title: 'Paper lesson', subject: 'science', courseId: 'chemistry', bank: 'science/paper',
        };
        if (id === 'science/video') return {
          unitId: id, title: 'Video lesson', subject: 'science', bank: 'science/video', document: 'print/video@abc',
        };
        return null;
      },
    };
    const useCase = new ListPrintableWorksheetSessions({ listLearnerSessions, curriculum });

    await expect(useCase.execute({ learnerId: 'learner3' })).resolves.toEqual([{
      sessionId: 'paper', unitId: 'science/paper', title: 'Paper lesson',
      subject: 'science', courseId: 'chemistry', state: 'created',
    }]);
  });
});
