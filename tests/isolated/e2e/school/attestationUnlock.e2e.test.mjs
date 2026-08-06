/**
 * Attestation gate-unlock through the PRODUCTION composition (M5 gate): an
 * attested unit unlocks its successor in the agenda and resolves a subject
 * ticket to the NEXT unit — while the daily-serving layer keeps reading raw
 * history, so the repair day itself still offers work instead of reporting
 * the subject already served.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { createLifecycleHarness, MEDIA_UNIT, WORKSHEET_UNIT, COURSE_ID, DEFAULT_LEARNER } from '../../../_lib/school/lifecycleHarness.mjs';
import { YamlAttestationLog } from '#adapters/persistence/yaml/YamlAttestationLog.mjs';

describe('attestation unlocks the planner without serving the subject', () => {
  let h;

  beforeAll(async () => {
    h = await createLifecycleHarness();
    await h.as(DEFAULT_LEARNER).assign({ courses: [COURSE_ID] });
  });

  it('before the attestation, unit 2 is locked behind unit 1', async () => {
    const plan = await h.plan();
    const entry = plan.entries.find((e) => e.unitId === WORKSHEET_UNIT);
    expect(entry.status).toBe('locked');
  });

  it('attesting unit 1 unlocks unit 2 in the agenda AND the subject still offers work today', async () => {
    // The same store the composition reads (household path inside the harness).
    const log = new YamlAttestationLog({
      configService: { getHouseholdPath: (rel) => path.join(h.dataDir, 'household', rel) },
    });
    await log.append({
      id: 'att_e2e', at: h.clock.iso(), attestedBy: 'grownup1',
      learnerId: DEFAULT_LEARNER, unitId: MEDIA_UNIT, reason: 'projector failed; watched together on the laptop',
    });

    const agenda = await h.agenda();
    const entryFor = (unitId) => agenda.plan.entries.find((e) => e.unitId === unitId);
    expect(entryFor(MEDIA_UNIT).status).toBe('completed'); // the attested unit
    expect(entryFor(WORKSHEET_UNIT).status).toBe('available'); // its successor, unlocked

    // The daily-serving layer read RAW history: math must still OFFER the
    // next unit today, not report itself served by the attestation.
    const math = agenda.sections.find((s) => s.subject === 'math');
    expect(math.servedToday).toBeFalsy();
    expect(math.next?.unitId).toBe(WORKSHEET_UNIT);
  });

  it('a subject ticket resolves to the successor, not the wedged unit', async () => {
    const scan = await h.scanCard();
    expect(scan.status).toBe('agenda_printed');
    const issued = await h.scanTokenMatching(/Unlike Denominators/i); // WORKSHEET_UNIT's own title — the successor
    expect(issued.status).toBe('issued');
    const session = await h.stores.sessions.listForLearner(DEFAULT_LEARNER);
    expect(session.some((s) => s.unitId === WORKSHEET_UNIT)).toBe(true);
  });
});
