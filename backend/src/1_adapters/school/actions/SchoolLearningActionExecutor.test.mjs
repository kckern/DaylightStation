import { describe, expect, it, vi } from 'vitest';
import { ISchoolLearningActionExecutor } from '#apps/school/ports/ISchoolLearningActionExecutor.mjs';
import { SchoolLearningActionExecutor } from './SchoolLearningActionExecutor.mjs';

describe('School learning-action side-effect adapter', () => {
  it('applies the existing learner print quota service rather than bypassing it', async () => {
    const requestPrint = vi.fn(async () => ({ decision: 'approval', pages: 4, requestId: 'pr_1' }));
    const adapter = new SchoolLearningActionExecutor().bind({ printService: { requestPrint } });
    expect(adapter).toBeInstanceOf(ISchoolLearningActionExecutor);
    const result = await adapter.execute({
      action: { kind: 'print_document', target: { printableId: 'motion', copies: 2 } },
      learnerId: 'user_4',
    });
    expect(requestPrint).toHaveBeenCalledWith({ userId: 'user_4', printableId: 'motion', copies: 2 });
    expect(result).toMatchObject({ status: 'pending_approval', printed: false, effect: { requestId: 'pr_1' } });
  });

  it('routes media through the existing trigger policy/debounce service', async () => {
    const handleTrigger = vi.fn(async () => ({ ok: true, dispatchId: 'd1', target: 'living-room' }));
    const adapter = new SchoolLearningActionExecutor().bind({
      triggerDispatchService: { handleTrigger },
    });
    const result = await adapter.execute({
      action: { kind: 'launch_media', target: { contentCode: 'living-room:media:velocity' } },
      scannerDevice: 'kitchen-scanner',
    });
    expect(handleTrigger).toHaveBeenCalledWith('kitchen-scanner', 'barcode', 'living-room:media:velocity');
    expect(result).toMatchObject({ status: 'launched', effect: { dispatchId: 'd1' } });
  });

  it('degrades without bound services or a learner instead of inventing authority', async () => {
    const adapter = new SchoolLearningActionExecutor();
    await expect(adapter.execute({ action: { kind: 'print_document', target: {} }, learnerId: 'kid' }))
      .resolves.toMatchObject({ status: 'unavailable' });
    adapter.bind({ printService: { requestPrint: vi.fn() } });
    await expect(adapter.execute({ action: { kind: 'print_document', target: {} }, learnerId: null }))
      .resolves.toMatchObject({ status: 'unavailable' });
    await expect(adapter.execute({ action: { kind: 'launch_media', target: {} }, scannerDevice: null }))
      .resolves.toMatchObject({ status: 'unavailable' });
  });
});
