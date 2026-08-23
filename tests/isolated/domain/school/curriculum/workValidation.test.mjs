import { describe, it, expect } from 'vitest';
import { validateWork } from '#domains/school/curriculum/workValidation.mjs';

describe('dated_modules progression', () => {
  // Come Follow Me: the calendar, not the learner, decides which week is open.
  // `module_order: fixed` is the honest answer for a dated course — the order
  // IS the calendar — and `grading`/`module_order` are both required of every
  // work, so a fixture missing them would fail for reasons that have nothing
  // to do with dating.
  const dated = (over = {}) => ({
    schema: 'school.course/v2', work: 'cfm', title: 'CFM', subject: 'scripture',
    category: 'course', medium: 'paper',
    structure: { shape: 'modules', module: 'week', items: { from: 'units', order: 'sequence' } },
    grading: { gate: 'review', scope: 'module', pass_percent: 80, exit: 'Study every week.' },
    progression: { mode: 'dated_modules', module_order: 'fixed', lesson_order: 'shuffle_once' },
    modules: [
      { module: 'w35', title: 'Week 35', opensOn: '2026-08-24', closesOn: '2026-08-30' },
      { module: 'w36', title: 'Week 36', opensOn: '2026-08-31', closesOn: '2026-09-06' },
    ],
    ...over,
  });

  it('accepts a well-formed dated course', () => {
    expect(validateWork(dated()).errors).toEqual([]);
  });

  it('does not require one_active_module (that is a module_blocks rule)', () => {
    expect(validateWork(dated()).errors.join()).not.toMatch(/one_active_module/);
  });

  it('rejects a module with no window', () => {
    const raw = dated();
    delete raw.modules[1].opensOn;
    expect(validateWork(raw).errors.join()).toMatch(/opensOn/);
  });

  it('rejects a malformed date', () => {
    const raw = dated();
    raw.modules[0].closesOn = 'Aug 30';
    expect(validateWork(raw).errors.join()).toMatch(/closesOn/);
  });

  it('rejects a window that closes before it opens', () => {
    const raw = dated();
    raw.modules[0].closesOn = '2026-08-20';
    expect(validateWork(raw).errors.join()).toMatch(/closes before/);
  });

  it('rejects overlapping windows — two modules cannot both be current', () => {
    const raw = dated();
    raw.modules[1].opensOn = '2026-08-29';
    expect(validateWork(raw).errors.join()).toMatch(/overlap/);
  });

  it('names the adjacent pair even when the modules are authored out of order', () => {
    const raw = dated();
    raw.modules.reverse();
    raw.modules[0].closesOn = '2026-09-06';   // w36 now first in the file
    raw.modules[1].opensOn = '2026-09-01';    // w35 pushed into w36's week
    const message = validateWork(raw).errors.join();
    expect(message).toMatch(/"w36" and "w35" have overlapping windows/);
  });

  it('rejects windows on a course that is not dated_modules', () => {
    const raw = dated({ progression: { mode: 'module_blocks', one_active_module: true, module_order: 'fixed', lesson_order: 'shuffle_once' } });
    expect(validateWork(raw).errors.join()).toMatch(/only meaningful/);
  });

  it('leaves module_blocks and sequential courses alone', () => {
    const raw = dated({
      progression: { mode: 'module_blocks', one_active_module: true, module_order: 'fixed', lesson_order: 'shuffle_once' },
      modules: [{ module: 'w35', title: 'Week 35' }, { module: 'w36', title: 'Week 36' }],
    });
    expect(validateWork(raw).errors).toEqual([]);
  });

  it('refuses the serial-chain knobs by name — a dated module gates nothing', () => {
    const raw = dated({
      progression: {
        mode: 'dated_modules', module_order: 'fixed', lesson_order: 'shuffle_once',
        one_active_module: true, required_opening_module: 'w35',
      },
    });
    const message = validateWork(raw).errors.join();
    expect(message).toMatch(/one_active_module is meaningless for dated_modules/);
    expect(message).toMatch(/required_opening_module is meaningless for dated_modules/);
  });

  it('rejects a dated course that enumerates no modules at all — nothing to date', () => {
    const raw = dated();
    delete raw.modules;
    expect(validateWork(raw).errors.join()).toMatch(/modules\[\] does not enumerate the windows/);
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    const raw = dated();
    raw.modules[1].closesOn = '2026-09-31';   // September has 30 days
    expect(validateWork(raw).errors.join()).toMatch(/closesOn/);
  });

  it('collects an error for an impossible month instead of throwing', () => {
    const raw = dated();
    raw.modules[0].opensOn = '2026-13-01';
    expect(() => validateWork(raw)).not.toThrow();
    expect(validateWork(raw).errors.join()).toMatch(/opensOn/);
  });
});
