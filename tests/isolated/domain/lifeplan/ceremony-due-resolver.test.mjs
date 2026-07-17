import { describe, it, expect } from 'vitest';
import { CeremonyDueResolver } from '#domains/lifeplan/services/CeremonyDueResolver.mjs';

const cadenceService = { isCeremonyDue: (timing) => timing === 'start_of_unit' };

describe('CeremonyDueResolver.listDue', () => {
  const plan = { ceremonies: {} };
  const cadencePosition = { unit: { periodId: '2026-07-17' }, cycle: { periodId: '2026-W29' } };

  it('lists a default-enabled ceremony that is due and not yet recorded', () => {
    const due = new CeremonyDueResolver({ cadenceService }).listDue({
      plan, cadencePosition, cadenceConfig: {}, today: '2026-07-17', hasRecord: () => false,
    });
    expect(due.map((d) => d.type)).toContain('unit_intention');
    expect(due.find((d) => d.type === 'unit_intention').title).toBe('Set your intention');
  });

  it('excludes a ceremony already recorded this period', () => {
    const due = new CeremonyDueResolver({ cadenceService }).listDue({
      plan, cadencePosition, cadenceConfig: {}, today: '2026-07-17',
      hasRecord: (type) => type === 'unit_intention',
    });
    expect(due.map((d) => d.type)).not.toContain('unit_intention');
  });
});
