import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetTeachers } from './GetTeachers.mjs';

const roster = () => [
  { id: 'kckern', name: 'KC', birthyear: 1984 },
  { id: 'liz', name: 'Elizabeth', birthyear: 1986 },
  { id: 'felix', name: 'Felix', birthyear: 2014 },
  { id: 'nan', name: 'Nan' }, // no birthyear — isAdult fails closed
];

let logger;
beforeEach(() => { logger = { warn: vi.fn() }; });

describe('GetTeachers', () => {
  it('absent key -> configured:false, empty list', async () => {
    const uc = new GetTeachers({ teachers: () => undefined, roster, logger });
    expect(await uc.execute()).toEqual({ configured: false, teachers: [] });
  });

  it('resolves ids at request time, dropping unknowns and children with a warning', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern', 'felix', 'ghost'], roster, logger });
    expect(await uc.execute()).toEqual({ configured: true, teachers: [{ id: 'kckern', name: 'KC' }] });
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.unresolved',
      expect.objectContaining({ id: 'felix', reason: 'not-a-grown-up' }));
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.unresolved',
      expect.objectContaining({ id: 'ghost', reason: 'not-on-roster' }));
  });

  it('a blank birthyear costs a picker entry, never a throw', async () => {
    const uc = new GetTeachers({ teachers: () => ['nan'], roster, logger });
    expect((await uc.execute()).teachers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.unresolved',
      expect.objectContaining({ id: 'nan' }));
  });

  it('duplicates and non-strings are dropped as bad shape', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern', 'kckern', 7, ''], roster, logger });
    const out = await uc.execute();
    expect(out.teachers).toEqual([{ id: 'kckern', name: 'KC' }]);
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.bad-shape', expect.anything());
  });

  it('configured-but-empty stays configured:true', async () => {
    const uc = new GetTeachers({ teachers: () => [], roster, logger });
    expect(await uc.execute()).toEqual({ configured: true, teachers: [] });
  });

  it('two teachers resolve in config order', async () => {
    const uc = new GetTeachers({ teachers: () => ['liz', 'kckern'], roster, logger });
    expect((await uc.execute()).teachers).toEqual([
      { id: 'liz', name: 'Elizabeth' }, { id: 'kckern', name: 'KC' },
    ]);
  });

  it('an unreadable roster refuses everyone (configured stays true)', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern'], roster: () => { throw new Error('boom'); }, logger });
    expect(await uc.execute()).toEqual({ configured: true, teachers: [] });
    expect(logger.warn).toHaveBeenCalledWith('school.teachers.roster-unreadable', expect.anything());
  });

  it('never leaks profile fields beyond id and name', async () => {
    const uc = new GetTeachers({ teachers: () => ['kckern'], roster, logger });
    const [teacher] = (await uc.execute()).teachers;
    expect(Object.keys(teacher).sort()).toEqual(['id', 'name']);
  });
});
