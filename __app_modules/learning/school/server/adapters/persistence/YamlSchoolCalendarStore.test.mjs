import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsyaml from 'js-yaml';
import { YamlSchoolCalendarStore, spliceTopLevel } from './YamlSchoolCalendarStore.mjs';
import { YamlHolidayActivityStore } from './YamlHolidayActivityStore.mjs';
import { validateSchedule } from '../../domain/schoolCalendar.mjs';
import { validateUnit } from '../../domain/curriculum/unitValidation.mjs';

// The live file's shape: no blank line between a node and the column-0
// comment of the next block, comments inside the list, a trailing key.
const LIVE_SHAPE = `lifecycle:
  enabled: true

calendar:
  except:
    # Past breaks keep the meaning they had on the day: nothing was asked.
    - { from: "2026-09-07", to: "2026-09-07", label: Labor Day, tier: away }
    - { from: "2026-11-26", to: "2026-11-26", label: Thanksgiving, tier: major-holiday,
        assignment: holiday-thanksgiving }
# What a day off still asks for, per tier.
dayOffTiers:
  major-holiday:
    keep:
      - subject: scripture
# Self-service panel codes.
selfService:
  enabled: true   # trailing
`;

const CAL = (extra = []) => ({ except: [
  { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day', tier: 'away' },
  { from: '2026-11-26', to: '2026-11-26', label: 'Thanksgiving', tier: 'major-holiday', assignment: 'holiday-thanksgiving' },
  ...extra,
] });
const TIERS = { 'major-holiday': { keep: [{ subject: 'scripture' }] } };

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calstore-'));
  const file = path.join(dir, 'school.yml');
  fs.writeFileSync(file, LIVE_SHAPE);
  let n = 0;
  const store = new YamlSchoolCalendarStore({
    filePath: file, backupDir: path.join(dir, 'backups'), historyPath: path.join(dir, 'history.yml'),
    clock: () => new Date(Date.UTC(2026, 10, 11, 18, 0, n++)),
  });
  return { dir, file, store };
}

describe('YamlSchoolCalendarStore — what the BOOT parser reads back', () => {
  it('three saves in a row stay valid for js-yaml, dates stay strings, other keys and comments survive', async () => {
    const { file, store } = makeStore();
    const trips = [
      { from: '2026-12-28', to: '2026-12-31', label: 'Trip', tier: 'away' },
      { from: '2027-01-02', to: '2027-01-02', label: 'Home: rest', tier: 'stay-home' },
      { from: '2027-02-15', to: '2027-02-15', label: 'Presidents "Day"', tier: 'enrichment', replaces: 'civilization', assignment: 'holiday-presidents-day' },
    ];
    for (let i = 0; i < trips.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await store.write({ calendar: CAL(trips.slice(0, i + 1)), dayOffTiers: TIERS, baseRevision: store.read().revision, editedBy: 'g' });
      const text = fs.readFileSync(file, 'utf8');
      const booted = jsyaml.load(text);
      const { errors, schedule } = validateSchedule(booted.calendar);
      expect(errors).toEqual([]);
      expect(schedule.except).toHaveLength(2 + i + 1);
      expect(typeof booted.calendar.except[0].from).toBe('string');
      expect(booted.dayOffTiers).toEqual(TIERS);
      expect(booted.lifecycle).toEqual({ enabled: true });
      expect(booted.selfService).toEqual({ enabled: true });
      expect(text).toContain('# What a day off still asks for, per tier.\ndayOffTiers:');
      expect(text).toContain('# Self-service panel codes.\nselfService:\n  enabled: true   # trailing');
    }
    expect(jsyaml.load(fs.readFileSync(file, 'utf8')).calendar.except[4].label).toBe('Presidents "Day"');
  });

  it('removing dayOffTiers keeps the comment that belongs to the next key', async () => {
    const { file, store } = makeStore();
    await store.write({ calendar: CAL(), dayOffTiers: null, baseRevision: store.read().revision, editedBy: 'g' });
    const text = fs.readFileSync(file, 'utf8');
    expect(jsyaml.load(text).dayOffTiers).toBeUndefined();
    expect(text).toContain('# Self-service panel codes.\nselfService:');
  });

  it('spliceTopLevel adds a missing key at the end and handles the last key in the file', () => {
    const added = spliceTopLevel('a: 1\n', 'calendar', { except: [{ from: '2026-12-01', to: '2026-12-01', tier: 'away' }] });
    expect(jsyaml.load(added)).toEqual({ a: 1, calendar: { except: [{ from: '2026-12-01', to: '2026-12-01', tier: 'away' }] } });
    const last = spliceTopLevel('a: 1\ncalendar:\n  except: []\n', 'calendar', null);
    expect(jsyaml.load(last)).toEqual({ a: 1 });
  });
});

describe('YamlSchoolCalendarStore — untouched keep-lists', () => {
  it('a calendar-only save leaves dayOffTiers byte-identical, comments included', async () => {
    const { file, store } = makeStore();
    const commented = LIVE_SHAPE.replace('      - subject: scripture\n', '      - subject: scripture   # kept\n');
    fs.writeFileSync(file, commented);
    await store.write({ calendar: CAL([{ from: '2026-12-28', to: '2026-12-31', label: 'Trip', tier: 'away' }]), dayOffTiers: TIERS, baseRevision: store.read().revision, editedBy: 'g' });
    expect(fs.readFileSync(file, 'utf8')).toContain('      - subject: scripture   # kept\n');
  });
});

describe('YamlHolidayActivityStore — the curriculum loader reads the unit back', () => {
  it('onDays stay strings for js-yaml and the unit validates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acts-'));
    const store = new YamlHolidayActivityStore({ contentRoot: dir, clock: () => new Date('2026-11-11T18:00:00Z') });
    const unit = store.compose({ unitId: 'holiday-x', subject: 'scripture', title: 'X', description: 'Do: it', onDays: ['2026-11-26', { from: '2026-12-24', to: '2026-12-25' }] });
    const file = store.write(unit);
    const loaded = jsyaml.load(fs.readFileSync(file, 'utf8'));
    expect(loaded.onDays).toEqual(['2026-11-26', { from: '2026-12-24', to: '2026-12-25' }]);
    expect(validateUnit(loaded).errors).toEqual([]);
  });
});
