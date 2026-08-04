import { describe, expect, it, vi } from 'vitest';
import { HydrateSchoolCalcActions } from './HydrateSchoolCalcActions.mjs';

const action = {
  schema: 'school.learning-action/v1', actionId: 'worksheet:velocity', title: 'Print worksheet',
  kind: 'print_document', enabled: true, tokenVersion: 3,
  policy: { replay: 'repeatable' }, target: { printableId: 'velocity-practice' },
};
const bundle = {
  schema: 'school.learning-lesson/v1',
  address: 'main/physics/mechanics/motion/velocity',
  context: {}, capabilities: ['reader@1', 'scan-action@1'],
  lesson: {
    lessonId: 'velocity', modules: [{
      moduleId: 'notes', type: 'lecture_notes', documentId: 'velocity-notes',
      document: {
        blocks: [
          { blockId: 'intro', type: 'prose', text: 'Velocity is displacement over time.' },
          { blockId: 'worksheet', type: 'scan_action', actionId: action.actionId, label: 'Print practice' },
        ],
      },
    }],
  },
};

describe('HydrateSchoolCalcActions', () => {
  it('registers each stable device binding and injects only its opaque token', async () => {
    const issue = vi.fn(async () => ({ token: 'sch:23456789ABCDEFGH', status: 'accepted', record: {} }));
    const result = await new HydrateSchoolCalcActions({
      content: { getLearningAction: async () => action }, issuer: { issue },
    }).execute({ deviceId: 'SC86A001', bundle });
    expect(issue).toHaveBeenCalledWith({
      deviceId: 'SC86A001', address: bundle.address, actionId: action.actionId, tokenVersion: 3,
    });
    expect(result.bundle.lesson.modules[0].document.blocks[1]).toEqual({
      ...bundle.lesson.modules[0].document.blocks[1], token: 'sch:23456789ABCDEFGH',
    });
    expect(JSON.stringify(result.bundle)).not.toContain('velocity-practice');
    expect(bundle.lesson.modules[0].document.blocks[1]).not.toHaveProperty('token');
  });

  it('fails closed if the mounted action disappears, becomes invalid, or is disabled', async () => {
    const issuer = { issue: vi.fn() };
    await expect(new HydrateSchoolCalcActions({
      content: { getLearningAction: async () => null }, issuer,
    }).execute({ deviceId: 'SC86A001', bundle })).rejects.toThrow(/not found during hydration/);
    await expect(new HydrateSchoolCalcActions({
      content: { getLearningAction: async () => ({ ...action, kind: 'command' }) }, issuer,
    }).execute({ deviceId: 'SC86A001', bundle })).rejects.toThrow(/invalid during hydration/);
    await expect(new HydrateSchoolCalcActions({
      content: { getLearningAction: async () => ({ ...action, enabled: false }) }, issuer,
    }).execute({ deviceId: 'SC86A001', bundle })).rejects.toThrow(/disabled/);
    expect(issuer.issue).not.toHaveBeenCalled();
  });
});
