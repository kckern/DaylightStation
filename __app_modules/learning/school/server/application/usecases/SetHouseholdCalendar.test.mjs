import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { SetHouseholdCalendar } from './SetHouseholdCalendar.mjs';
import { GetHouseholdCalendar } from './GetHouseholdCalendar.mjs';
import { YamlSchoolCalendarStore } from '../../adapters/persistence/YamlSchoolCalendarStore.mjs';
import { YamlHolidayActivityStore } from '../../adapters/persistence/YamlHolidayActivityStore.mjs';
import { LiveHouseholdCalendar } from '../LiveHouseholdCalendar.mjs';

const SCHOOL_YML = `# School policy
students:
  - a   # a learner

calendar:
  except:
    # past breaks keep their meaning
    - { from: "2026-11-02", to: "2026-11-02", label: Past day, tier: away }
    - { from: "2026-11-26", to: "2026-11-26", label: Thanksgiving, tier: major-holiday,
        assignment: holiday-thanksgiving }

# What a day off keeps
dayOffTiers:
  major-holiday:
    keep:
      - subject: scripture

teachers:
  - grownup   # trailing comment survives
`;
const NOW = new Date('2026-11-11T18:00:00Z');
const silent = { info: vi.fn(), warn: vi.fn(), error() {}, debug() {} };

let dir; let file; let content; let store; let activities; let live; let gate; let curriculum; let assignments; let uc;
const unitFile = (subject, id) => path.join(content, subject, 'holiday-activities', 'units', `${id}.yml`);
const PAST = { from: '2026-11-02', to: '2026-11-02', label: 'Past day', tier: 'away' };
const THANKS = { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-'));
  file = path.join(dir, 'school', 'school.yml');
  content = path.join(dir, 'content');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, SCHOOL_YML);
  fs.mkdirSync(path.dirname(unitFile('scripture', 'holiday-thanksgiving')), { recursive: true });
  fs.writeFileSync(unitFile('scripture', 'holiday-thanksgiving'), YAML.stringify({
    schema: 'school.unit/v1', unitId: 'holiday-thanksgiving', title: 'Thanksgiving activity (to be written)',
    subject: 'scripture', onDays: ['2026-11-26'], placeholder: true,
    provenance: { source: 'Household holiday activity', reviewState: 'approved' },
  }));
  store = new YamlSchoolCalendarStore({
    filePath: file, backupDir: path.join(dir, 'school', 'backups'),
    historyPath: path.join(dir, 'school', 'plans', 'calendar-history.yml'), clock: () => NOW,
  });
  activities = new YamlHolidayActivityStore({ contentRoot: content, clock: () => NOW });
  live = new LiveHouseholdCalendar({ schedule: null });
  gate = { assert: vi.fn() };
  curriculum = { invalidate: vi.fn(), getUnit: vi.fn(async () => null), listUnits: vi.fn(async () => []) };
  const plans = { kid: { learnerId: 'kid', courses: [{ courseId: 'c' }], units: ['holiday-thanksgiving'], programs: [] } };
  assignments = {
    get: vi.fn(async (id) => plans[id] ?? null),
    put: vi.fn(async (record) => { plans[record.learnerId] = record; return record; }),
    plans,
  };
  uc = new SetHouseholdCalendar({
    store, activities, assignments, teacherGate: gate, liveCalendar: live, curriculum,
    reloadConfig: vi.fn(), timezone: 'America/Los_Angeles', clock: () => NOW, logger: silent,
  });
});

const rev = () => store.read().revision;
const backups = () => (fs.existsSync(path.join(dir, 'school', 'backups')) ? fs.readdirSync(path.join(dir, 'school', 'backups')) : []);

describe('SetHouseholdCalendar', () => {
  it('adds a break: comments elsewhere survive, backup taken, live calendar swapped, cache dropped', async () => {
    const out = await uc.execute({
      except: [PAST, THANKS, { from: '2026-11-20', to: '2026-11-21', label: 'Trip', tier: 'away' }],
      dayOffTiers: { 'major-holiday': { keep: [{ subject: 'scripture' }] } },
      editedBy: 'grownup', baseRevision: rev(),
    });
    const written = fs.readFileSync(file, 'utf8');
    expect(written).toContain('# School policy');
    expect(written).toContain('  - a   # a learner');
    expect(written).toContain('  - grownup   # trailing comment survives');
    expect(written).toContain('- { from: "2026-11-20", to: "2026-11-21", label: "Trip", tier: "away" }');
    expect(YAML.parse(written).calendar.except).toHaveLength(3);
    expect(backups()).toEqual(['school.yml.20261111T180000Z']);
    expect(fs.readFileSync(path.join(dir, 'school', 'backups', backups()[0]), 'utf8')).toBe(SCHOOL_YML);
    expect(out.revision).toBe(rev());
    expect(live.schedule().except.map((s) => s.label)).toEqual(['Past day', 'Thanksgiving', 'Trip']);
    expect(curriculum.invalidate).toHaveBeenCalled();
    expect(gate.assert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'grownup', action: 'calendar.edit' }));
    expect(store.history()).toEqual([expect.objectContaining({ editedBy: 'grownup', breaks: 3 })]);
  });

  it('refuses a stale save and writes nothing', async () => {
    const base = rev();
    fs.appendFileSync(file, '# hand edit\n');
    const handEdited = fs.readFileSync(file, 'utf8');
    await expect(uc.execute({ except: [PAST, THANKS], editedBy: 'grownup', baseRevision: base }))
      .rejects.toMatchObject({ code: 'STALE_SAVE' });
    expect(fs.readFileSync(file, 'utf8')).toBe(handEdited);
    expect(backups()).toEqual([]);
  });

  it('refuses an invalid tier with the file byte-identical and no backup', async () => {
    await expect(uc.execute({
      except: [PAST, THANKS, { from: '2026-12-01', to: '2026-12-01', label: 'X', tier: 'stayhome' }],
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'CALENDAR_INVALID' });
    expect(fs.readFileSync(file, 'utf8')).toBe(SCHOOL_YML);
    expect(backups()).toEqual([]);
  });

  it('refuses an enrichment break with no subject, and a break with no tier', async () => {
    await expect(uc.execute({
      except: [PAST, THANKS, { from: '2026-12-01', to: '2026-12-01', label: 'Science day', tier: 'enrichment' }],
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'CALENDAR_INVALID' });
    await expect(uc.execute({
      except: [PAST, THANKS, { from: '2026-12-01', to: '2026-12-01', label: 'Untagged' }],
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'CALENDAR_INVALID' });
    expect(fs.readFileSync(file, 'utf8')).toBe(SCHOOL_YML);
  });

  it('refuses a change to a day already judged', async () => {
    await expect(uc.execute({
      except: [{ ...PAST, tier: 'stay-home' }, THANKS], editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'PAST_DAYS_LOCKED', details: { days: ['2026-11-02'] } });
    expect(fs.readFileSync(file, 'utf8')).toBe(SCHOOL_YML);
  });

  it('a gate refusal writes nothing', async () => {
    gate.assert.mockImplementation(() => { throw Object.assign(new Error('no'), { code: 'FORBIDDEN' }); });
    await expect(uc.execute({ except: [PAST, THANKS], editedBy: 'kid', baseRevision: rev() })).rejects.toThrow('no');
    expect(fs.readFileSync(file, 'utf8')).toBe(SCHOOL_YML);
  });

  it('writes a new enrichment activity on its subject shelf and assigns it once', async () => {
    const science = { from: '2026-12-07', to: '2026-12-08', label: 'Science fair', tier: 'enrichment', replaces: 'science', assignment: 'holiday-science-fair' };
    await uc.execute({
      except: [PAST, THANKS, science],
      activities: [{ unitId: 'holiday-science-fair', title: 'Build a volcano', instructions: 'Follow the kit.' }],
      assignTo: ['kid'], editedBy: 'grownup', baseRevision: rev(),
    });
    const unit = YAML.parse(fs.readFileSync(unitFile('science', 'holiday-science-fair'), 'utf8'));
    expect(unit).toMatchObject({
      unitId: 'holiday-science-fair', subject: 'science', title: 'Build a volcano', description: 'Follow the kit.',
      onDays: [{ from: '2026-12-07', to: '2026-12-08' }],
      provenance: { reviewState: 'approved' },
    });
    // Instructions make it a real assignment that counts.
    expect(unit).not.toHaveProperty('placeholder');
    expect(assignments.plans.kid.units).toEqual(['holiday-thanksgiving', 'holiday-science-fair']);
    expect(assignments.plans.kid.courses).toEqual([{ courseId: 'c' }]);
    await uc.execute({
      except: [PAST, THANKS, science],
      activities: [{ unitId: 'holiday-science-fair', title: 'Build a volcano', instructions: 'Follow the kit.' }],
      assignTo: ['kid'], editedBy: 'grownup', baseRevision: rev(),
    });
    expect(assignments.put).toHaveBeenCalledTimes(1);
  });

  it('keeps an activity with blank instructions a placeholder, and makes it real once written', async () => {
    await uc.execute({
      except: [PAST, THANKS],
      activities: [{ unitId: 'holiday-thanksgiving', title: 'Gratitude list', instructions: '   ' }],
      editedBy: 'grownup', baseRevision: rev(),
    });
    const first = YAML.parse(fs.readFileSync(unitFile('scripture', 'holiday-thanksgiving'), 'utf8'));
    expect(first.placeholder).toBe(true);
    expect(first).not.toHaveProperty('description');
    const get = new GetHouseholdCalendar({ store, activities, curriculum, programIds: () => [], timezone: 'America/Los_Angeles', clock: () => NOW });
    expect((await get.execute()).activities['holiday-thanksgiving'].placeholder).toBe(true);
  });

  it('reads a hand-edited activity with instructions as counting, whatever its stale flag says', async () => {
    fs.writeFileSync(unitFile('scripture', 'holiday-thanksgiving'), YAML.stringify({
      schema: 'school.unit/v1', unitId: 'holiday-thanksgiving', title: 'Gratitude', subject: 'scripture',
      description: 'Write five things.', onDays: ['2026-11-26'], placeholder: true, objectives: [],
      provenance: { source: 'Household', reviewState: 'approved' },
    }));
    const get = new GetHouseholdCalendar({ store, activities, curriculum, programIds: () => [], timezone: 'America/Los_Angeles', clock: () => NOW });
    expect((await get.execute()).activities['holiday-thanksgiving']).toMatchObject({ placeholder: false, instructions: 'Write five things.' });
  });

  it('rewrites a placeholder activity text, keeping a backup of the old file', async () => {
    await uc.execute({
      except: [PAST, THANKS],
      activities: [{ unitId: 'holiday-thanksgiving', title: 'Gratitude list', instructions: 'Write five things.' }],
      editedBy: 'grownup', baseRevision: rev(),
    });
    const shelf = path.dirname(unitFile('scripture', 'holiday-thanksgiving'));
    expect(fs.readdirSync(shelf).sort()).toEqual(['holiday-thanksgiving.yml', 'holiday-thanksgiving.yml.bak-20261111T180000Z']);
    expect(YAML.parse(fs.readFileSync(unitFile('scripture', 'holiday-thanksgiving'), 'utf8'))).toMatchObject({
      title: 'Gratitude list', description: 'Write five things.', onDays: ['2026-11-26'],
    });
    expect(YAML.parse(fs.readFileSync(unitFile('scripture', 'holiday-thanksgiving'), 'utf8'))).not.toHaveProperty('placeholder');
  });

  it('refuses an activity no break names, and one authored in a course', async () => {
    await expect(uc.execute({
      except: [PAST, THANKS], activities: [{ unitId: 'holiday-nothing', title: 'X' }],
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'ACTIVITY_INVALID' });
    curriculum.getUnit.mockResolvedValue({ unitId: 'civ-lesson' });
    await expect(uc.execute({
      except: [PAST, { ...THANKS, assignment: 'civ-lesson' }], activities: [{ unitId: 'civ-lesson', title: 'X' }],
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'ACTIVITY_NOT_EDITABLE' });
  });

  it('a failed assignment never leaves the saved calendar unapplied; the term rows are told', async () => {
    const onUpdated = vi.fn();
    uc = new SetHouseholdCalendar({
      store, activities, assignments, teacherGate: gate, liveCalendar: live, curriculum,
      timezone: 'America/Los_Angeles', clock: () => NOW, logger: silent, onUpdated,
    });
    assignments.put.mockRejectedValue(Object.assign(new Error('corrupt'), { code: 'ASSIGNMENTS_CORRUPT' }));
    const science = { from: '2026-12-07', to: '2026-12-07', label: 'Science fair', tier: 'enrichment', replaces: 'science', assignment: 'holiday-science-fair' };
    const out = await uc.execute({
      except: [PAST, THANKS, science], activities: [{ unitId: 'holiday-science-fair', title: 'Volcano' }],
      assignTo: ['kid'], editedBy: 'grownup', baseRevision: rev(),
    });
    expect(out.unassigned).toEqual(['kid']);
    expect(live.schedule().except.map((s) => s.label)).toContain('Science fair');
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it('holds a keep-list change while yesterday was that tier', async () => {
    const yesterdayHome = { from: '2026-11-10', to: '2026-11-10', label: 'Home day', tier: 'stay-home' };
    fs.writeFileSync(file, SCHOOL_YML.replace('    - { from: "2026-11-02"', '    - { from: "2026-11-10", to: "2026-11-10", label: Home day, tier: stay-home }\n    - { from: "2026-11-02"'));
    await expect(uc.execute({
      except: [yesterdayHome, PAST, THANKS],
      dayOffTiers: { 'stay-home': { keep: [{ subject: 'scripture' }] }, 'major-holiday': { keep: [{ subject: 'scripture' }] } },
      editedBy: 'grownup', baseRevision: rev(),
    })).rejects.toMatchObject({ code: 'KEEP_LIST_YESTERDAY' });
  });
});

describe('GetHouseholdCalendar', () => {
  it('returns the breaks, activities, keep-lists and the revision a save must carry', async () => {
    const get = new GetHouseholdCalendar({ store, activities, curriculum, programIds: () => ['story-time'], timezone: 'America/Los_Angeles', clock: () => NOW });
    const out = await get.execute();
    expect(out.revision).toBe(rev());
    expect(out.today).toBe('2026-11-11');
    expect(out.except).toHaveLength(2);
    expect(out.activities['holiday-thanksgiving']).toMatchObject({ subject: 'scripture', placeholder: true, editable: true });
    expect(out.effectivePolicy['major-holiday'].keep).toEqual([{ subject: 'scripture' }]);
    expect(out.tiers).toContain('enrichment');
    expect(out.programs).toEqual(['story-time']);
  });
});

describe('SetHouseholdCalendar — the tablet hears a calendar edit', () => {
  it('announces a household-wide change once the calendar is written', async () => {
    const realtime = { recordChanged: vi.fn() };
    const withRealtime = new SetHouseholdCalendar({
      store, activities, assignments, teacherGate: gate, liveCalendar: live, curriculum,
      reloadConfig: vi.fn(), timezone: 'America/Los_Angeles', clock: () => NOW, logger: silent, realtime,
    });
    await withRealtime.execute({ except: [PAST, THANKS], editedBy: 'grownup', baseRevision: rev() });
    expect(realtime.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: [], kind: 'calendar' }));
  });
});
