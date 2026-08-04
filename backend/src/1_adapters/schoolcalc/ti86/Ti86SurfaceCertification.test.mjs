import { describe, expect, it } from 'vitest';
import { Ti86SchoolCalcCodec } from './Ti86SchoolCalcCodec.mjs';
import { Ti86SurfaceCertification, ti86CodecBaselineProfile } from './Ti86SurfaceCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';

const renderableBundle = {
  schema: 'school.learning-lesson/v1',
  address: 'main/markets/finance/interest/compound-growth',
  context: {
    catalog: { catalogId: 'main', title: 'Main Catalog' },
    subject: { subjectId: 'markets', title: 'Markets' },
    course: { courseId: 'finance', title: 'Finance' },
    unit: { unitId: 'interest', title: 'Interest' },
  },
  lesson: {
    lessonId: 'compound-growth',
    title: 'Compound growth',
    shortTitle: 'Growth',
    objectives: ['Compare growth'],
    modules: [{
      moduleId: 'quiz',
      type: 'quiz',
      bankId: 'finance:compound-check',
      passingPercent: 80,
      bank: {
        id: 'finance:compound-check',
        title: 'Check',
        items: [{
          id: 'q1', type: 'multiple_choice', prompt: 'Which grows?',
          choices: ['Principal', 'Principal plus interest'], answer: 'Principal plus interest',
        }],
      },
    }],
  },
  capabilities: ['quiz@1', 'response.choice@1'],
};

const oversizedBundle = structuredClone(renderableBundle);
oversizedBundle.lesson.modules = [{
  moduleId: 'notes', type: 'lecture_notes',
  document: { blocks: Array.from({ length: 400 }, (_, i) => ({
    blockId: `p${i}`, type: 'prose', text: `Filler paragraph ${i} `.repeat(10),
  })) },
}];

const makePort = () => new Ti86SurfaceCertification({ codec: new Ti86SchoolCalcCodec() });

runCertificationPortContract({
  name: 'ti86',
  makePort,
  profile: ti86CodecBaselineProfile(),
  renderableBundle,
  incompatibleBundle: oversizedBundle,
});

describe('Ti86SurfaceCertification specifics', () => {
  it('surfaces the compile-time byte ceiling as a reason, not a throw (spec §6.2)', () => {
    const result = makePort().certify(oversizedBundle, ti86CodecBaselineProfile());
    expect(result.lesson.verdict).toBe('none'); // fullOrNothing
    expect(result.modules[0].reasons.join()).toMatch(/bytes/);
  });

  it('agrees with supports() reasons for capability misses', () => {
    const bundle = structuredClone(renderableBundle);
    bundle.capabilities = [...(bundle.capabilities ?? []), 'image@1'];
    const port = makePort();
    const supports = new Ti86SchoolCalcCodec().supports(bundle);
    const certified = port.certify(bundle, ti86CodecBaselineProfile());
    expect(supports.compatible).toBe(false);
    for (const reason of supports.reasons) {
      expect(certified.modules.flatMap((m) => m.reasons)).toContain(reason);
    }
  });

  it('attributes `module <i>` reasons only to that module', () => {
    // Two modules; make the SECOND one invalid for TI-86 projection (an asset
    // block, which the reader cannot project) so the codec emits a
    // `module 1 …` reason. The first module must stay clean of it.
    const bundle = structuredClone(renderableBundle);
    bundle.lesson.modules = [
      renderableBundle.lesson.modules[0],
      { moduleId: 'notes2', type: 'lecture_notes',
        document: { blocks: [{ blockId: 'a', type: 'asset', assetId: 'pic', alt: 'x' }] } },
    ];
    const result = makePort().certify(bundle, ti86CodecBaselineProfile());
    const moduleScoped = result.modules[1].reasons.filter((r) => /^module 1\b/.test(r));
    expect(moduleScoped.length).toBeGreaterThan(0);
    expect(result.modules[0].reasons.filter((r) => /^module 1\b/.test(r))).toEqual([]);
  });

  it('rejects tracked work when the profile offers no return channel', () => {
    const base = ti86CodecBaselineProfile();
    const noReturn = { ...base, capabilities: base.capabilities.filter((c) => !c.startsWith('return.')) };
    const result = makePort().certify(renderableBundle, noReturn);
    expect(result.lesson.verdict).toBe('none');
    expect(result.modules.flatMap((m) => m.reasons).join()).toMatch(/return channel/);
  });

  it('reports resource bytes for a compilable lesson', () => {
    const { resource } = makePort().certify(renderableBundle, ti86CodecBaselineProfile());
    expect(resource.estimatedBytes).toBeGreaterThan(0);
    expect(resource.limitsApplied.hardCeilingBytes).toBe(12288);
  });
});
