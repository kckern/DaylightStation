// @vitest-environment node
/**
 * A shelf can carry more than one assigned program on the same day (piano and
 * a printed coloring page both on `arts`). The section offers ONE `next`, so
 * the second owed program used to be invisible on the status board until the
 * first was finished (2026-11-13). `pendingPrograms` names the rest of today's
 * still-owed programs; `next` is never repeated in it.
 *
 * The same shelf also showed the WRONG progress label: with piano done and the
 * maze next, the maze card read piano's "Done today — Lesson 43 …" because the
 * section label came from whichever program status was listed first.
 */
import { describe, it, expect } from 'vitest';
import { planDailyAgenda } from "./agenda.mjs";

const FRIDAY = '2026-11-13T18:00:00.000Z';
const SATURDAY = '2026-11-14T18:00:00.000Z';
const WEEKDAYS = [1, 2, 3, 4, 5];

const program = (program, programInstance, extra = {}) => ({
  unitId: `${program}:${programInstance}`, title: `${program} ${programInstance}`, subject: 'arts',
  program, programInstance, cadence: 'daily', status: 'available', timingState: 'available',
  elective: false, schedule: { daysOfWeek: WEEKDAYS }, ...extra,
});
const piano = program('piano-course', 'learner-a-piano');
const coloring = program('printed-activity', 'beeloo:coloring');

const status = (extra = {}) => ({ doneToday: false, progressLabel: null, ...extra });
const arts = (entries, statuses, now = FRIDAY) => planDailyAgenda({
  plan: { entries: entries.map((e) => ({ ...e })) }, now, programStatuses: statuses,
}).sections.find((s) => s.subject === 'arts');

describe('planDailyAgenda — pendingPrograms', () => {
  it('two unstarted programs on one shelf: one is next, the other is pending', () => {
    const section = arts([piano, coloring], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': status({ obligationProgress: { completed: 0, total: 1 } }),
    });
    expect(section.next.unitId).toBe(piano.unitId);
    expect(section.pendingPrograms).toEqual([{
      unitId: coloring.unitId,
      program: 'printed-activity',
      programInstance: 'beeloo:coloring',
      title: coloring.title,
      subject: 'arts',
      obligationProgress: { completed: 0, total: 1 },
    }]);
  });

  it('a program scheduled for other weekdays is not pending today', () => {
    const tueThu = program('printed-activity', 'beeloo:maze', { schedule: { daysOfWeek: [2, 4] } });
    const section = arts([piano, tueThu], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:maze': status(),
    });
    expect(section.next.unitId).toBe(piano.unitId);
    expect(section.pendingPrograms).toEqual([]);
  });

  it('a program done today is not pending', () => {
    const maze = program('printed-activity', 'beeloo:maze');
    const section = arts([piano, coloring, maze], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': status({ doneToday: true }),
      'printed-activity::beeloo:maze': status(),
    });
    expect(section.next.unitId).toBe(piano.unitId);
    expect(section.pendingPrograms.map((p) => p.unitId)).toEqual([maze.unitId]);
  });

  it('an elective program is not pending', () => {
    const section = arts([piano, { ...coloring, elective: true }], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': status(),
    });
    expect(section.pendingPrograms).toEqual([]);
  });

  it('an unavailable program faults the section and is not listed as pending', () => {
    const section = arts([piano, coloring], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': { error: true },
    });
    expect(section.obligation.state).toBe('faulted');
    expect(section.pendingPrograms).toEqual([]);
  });

  it('an excused section lists nothing pending', () => {
    const section = arts([piano, coloring], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': status(),
    }, SATURDAY);
    expect(section.obligation.state).toBe('excused');
    expect(section.pendingPrograms).toEqual([]);
  });

  it('curriculum on the shelf stays one-pass: a second curriculum unit is never pending', () => {
    const lesson = (id) => ({ unitId: id, title: id, subject: 'arts', status: 'available', timingState: 'available', elective: false });
    const section = arts([lesson('arts.01'), lesson('arts.02')], {});
    expect(section.next.unitId).toBe('arts.01');
    expect(section.pendingPrograms).toEqual([]);
  });

  it('a program beside a curriculum next is pending', () => {
    const lesson = { unitId: 'arts.01', title: 'Arts 1', subject: 'arts', status: 'available', timingState: 'available', elective: false, timingPriority: 1 };
    const section = arts([lesson, coloring], { 'printed-activity::beeloo:coloring': status() });
    expect(section.next.unitId).toBe('arts.01');
    expect(section.pendingPrograms.map((p) => p.unitId)).toEqual([coloring.unitId]);
  });
});

describe('planDailyAgenda — assignment icons reach every disc source', () => {
  it('next, pendingPrograms and servedWork carry the owning entry\'s icon', () => {
    const maze = program('printed-activity', 'beeloo:maze', { icon: 'maze' });
    const pending = arts([{ ...piano, icon: 'music' }, { ...coloring, icon: 'crayon' }], {
      'piano-course::learner-a-piano': status(),
      'printed-activity::beeloo:coloring': status(),
    });
    expect(pending.next.icon).toBe('music');
    expect(pending.pendingPrograms[0].icon).toBe('crayon');

    const served = arts([{ ...piano, icon: 'music' }, maze], {
      'piano-course::learner-a-piano': status({ doneToday: true, servedWork: [{ unitId: 'plex:43', title: 'Lesson 43' }] }),
      'printed-activity::beeloo:maze': status(),
    });
    expect(served.servedWork).toEqual([{ unitId: 'plex:43', title: 'Lesson 43', assignmentUnitId: piano.unitId, icon: 'music' }]);
    expect(served.next.icon).toBe('maze');
  });
});

describe('planDailyAgenda — a shelf of several programs labels the right one', () => {
  const maze = program('printed-activity', 'beeloo:maze');

  it('next is the open program: the section label and rows are its own, not the done program\'s', () => {
    const section = arts([piano, maze], {
      'piano-course::learner-a-piano': status({
        doneToday: true,
        progressLabel: 'Done today — Lesson 43 · 55/113',
        progress: [{ label: 'Course', completed: 55, total: 113 }],
        servedWork: [{ unitId: 'piano-course:lesson-43', title: 'Lesson 43' }],
      }),
      'printed-activity::beeloo:maze': status({
        progressLabel: '0 of 1 sheet',
        progress: [{ label: 'Sheets', completed: 0, total: 1 }],
        obligationProgress: { completed: 0, total: 1 },
      }),
    });
    expect(section.next.unitId).toBe(maze.unitId);
    expect(section.progressLabel).toBe('0 of 1 sheet');
    expect(section.progressRows).toEqual([{ label: 'Sheets', completed: 0, total: 1 }]);
  });

  it('with nothing next, the label is the program done today', () => {
    const section = arts([maze, piano], {
      'printed-activity::beeloo:maze': status({ doneToday: true, progressLabel: '1 of 1 sheet' }),
      'piano-course::learner-a-piano': status({ doneToday: true, progressLabel: 'Done today — Lesson 43' }),
    });
    expect(section.next).toBeNull();
    expect(section.progressLabel).toBe('1 of 1 sheet');
  });

  it('a next with no label of its own does not borrow another program\'s', () => {
    const section = arts([piano, maze], {
      'piano-course::learner-a-piano': status({ doneToday: true, progressLabel: 'Done today — Lesson 43' }),
      'printed-activity::beeloo:maze': status(),
    });
    expect(section.next.unitId).toBe(maze.unitId);
    expect(section.progressLabel).toBeNull();
  });
});

describe('planDailyAgenda — a program off today on a shared shelf', () => {
  // A learner on 2026-11-13 (a Friday): piano and the maze done, a Tue/Thu coloring
  // sheet on the same arts shelf. It was offered as next and held the day open.
  const maze = program('printed-activity', 'beeloo:maze', { schedule: { daysOfWeek: [1, 3, 5] } });
  const tueThu = program('printed-activity', 'beeloo:colorbynumber', { schedule: { daysOfWeek: [2, 4] } });

  it('is not offered, and does not hold the shelf open', () => {
    const section = arts([piano, maze, tueThu], {
      'piano-course::learner-a-piano': status({ doneToday: true }),
      'printed-activity::beeloo:maze': status({ doneToday: true }),
      'printed-activity::beeloo:colorbynumber': status(),
    });
    expect(section.next).toBeNull();
    expect(section.obligation.state).toBe('served');
  });

  it('is offered on its own day', () => {
    const THURSDAY = '2026-11-12T18:00:00.000Z';
    const section = arts([piano, tueThu], {
      'piano-course::learner-a-piano': status({ doneToday: true }),
      'printed-activity::beeloo:colorbynumber': status(),
    }, THURSDAY);
    expect(section.next.unitId).toBe(tueThu.unitId);
    expect(section.obligation.state).not.toBe('served');
  });
});
