import { describe, expect, it, vi } from 'vitest';
import { ResolveSchoolCalcAction } from './ResolveSchoolCalcAction.mjs';

const action = {
  schema: 'school.learning-action/v1', actionId: 'worksheet:velocity', title: 'Print practice',
  kind: 'print_document', tokenVersion: 2, policy: { replay: 'repeatable' },
  target: { printableId: 'velocity-practice' },
};
const record = {
  tokenClass: 'learning_action',
  subject: {
    deviceId: 'SC86A001', address: 'main/physics/mechanics/motion/velocity',
    actionId: action.actionId, tokenVersion: 2,
  },
};

function useCase({ device = { deviceId: 'SC86A001' }, definition = action, result = null } = {}) {
  const execute = vi.fn(async () => result ?? ({
    status: 'printed', message: 'Worksheet printed.', physical: 'worksheet', printed: true,
    effect: { printableId: 'velocity-practice' },
  }));
  return {
    execute,
    useCase: new ResolveSchoolCalcAction({
      devices: { getDevice: async () => device },
      content: { getLearningAction: async () => definition },
      executor: { execute },
    }),
  };
}

describe('ResolveSchoolCalcAction', () => {
  it('resolves current server policy without inferring the learner from the calculator', async () => {
    const { useCase: resolver, execute } = useCase();
    const result = await resolver.execute({ record, scannerDevice: 'kitchen-scanner' });
    expect(result).toMatchObject({ status: 'printed', physical: 'worksheet', printed: true });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ actionId: action.actionId, kind: 'print_document' }),
      learnerId: null, deviceId: 'SC86A001',
      lessonAddress: record.subject.address, scannerDevice: 'kitchen-scanner',
    }));
  });

  it('rejects unknown devices, removed actions, disabled actions, and rotated versions before effects', async () => {
    const cases = [
      { device: null },
      { definition: null },
      { definition: { ...action, enabled: false } },
      { definition: { ...action, tokenVersion: 3 } },
    ];
    for (const entry of cases) {
      const { useCase: resolver, execute } = useCase(entry);
      // eslint-disable-next-line no-await-in-loop
      const result = await resolver.execute({ record });
      expect(['unavailable', 'stale']).toContain(result.status);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('does not accept another token class or malformed executor output', async () => {
    const { useCase: resolver, execute } = useCase();
    expect(await resolver.execute({ record: { ...record, tokenClass: 'identify' } }))
      .toMatchObject({ status: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
    const broken = useCase({ result: { ok: true } }).useCase;
    await expect(broken.execute({ record })).rejects.toThrow(/invalid result/);
  });
});
