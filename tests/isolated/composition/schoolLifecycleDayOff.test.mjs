// @vitest-environment node
//
// The household calendar's day-off tiers are read once, at composition. An
// untagged break and an enrichment break naming a unit that does not exist are
// both things a grown-up should hear about at boot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSchoolLifecycle } from "../../../__app_modules/learning/school/server/composition/schoolLifecycle.mjs";

let dataDir;
beforeEach(async () => { dataDir = await mkdtemp(path.join(os.tmpdir(), 'school-dayoff-')); });
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

function wire(schoolConfig) {
  const warns = [];
  const logger = { info() {}, debug() {}, error() {}, warn: (event, data) => warns.push({ event, data }) };
  const result = createSchoolLifecycle({
    configService: {
      getHouseholdAppConfig: () => schoolConfig,
      getDataDir: () => dataDir,
      getHouseholdPath: (rel) => `${dataDir}/household/${rel}`,
      getDeviceConfig: () => null,
    },
    schoolService: { listBanks: () => [], getBank: () => null },
    eventBus: { broadcast() {}, onClientMessage() {}, subscribe() {} },
    logger,
  });
  return { result, warns };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('day-off tiers at composition', () => {
  it('warns once about untiered breaks and an enrichment assignment that is not a unit', async () => {
    const { result, warns } = wire({
      lifecycle: { enabled: true }, printing: { host: 'printer.local' },
      calendar: {
        except: [
          { from: '2026-09-07', to: '2026-09-07', label: 'Labor Day' },
          { from: '2026-11-11', to: '2026-11-11', label: 'Veterans Day', tier: 'enrichment', replaces: 'civilization', assignment: 'holiday-nowhere' },
        ],
      },
    });
    expect((await result).wired).toBe(true);
    await settle();
    expect(warns.filter((w) => w.event === 'school.calendar.untiered')).toEqual([
      { event: 'school.calendar.untiered', data: { labels: ['Labor Day'] } },
    ]);
    expect(warns.filter((w) => w.event === 'school.calendar.assignment-missing')).toEqual([
      { event: 'school.calendar.assignment-missing', data: { label: 'Veterans Day', assignment: 'holiday-nowhere' } },
    ]);
  });

  it('warns about a bad dayOffTiers block', async () => {
    const { result, warns } = wire({
      lifecycle: { enabled: true }, printing: { host: 'printer.local' },
      dayOffTiers: { holiday: { keep: [] } },
    });
    await result;
    expect(warns.find((w) => w.event === 'school.day-off-policy.invalid')?.data.errors.join()).toMatch(/holiday/);
  });
});
