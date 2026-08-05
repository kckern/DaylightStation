// backend/src/1_adapters/school/screen/ScreenCertification.test.mjs
import { describe, expect, it } from 'vitest';
import { ScreenCertification } from './ScreenCertification.mjs';
import { runCertificationPortContract } from '../../../../../tests/_lib/school/certificationContract.mjs';
// Fixtures are shared from the paper port's test file (created in Task 7):
import { renderableBundle } from '../paper/PaperCertification.test.mjs';

const screenProfile = {
  surfaceId: 'screen-office', family: 'screen', liveness: 'static',
  capabilities: [
    'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
    'activity.matching@1', 'calculator@1', 'graph@1',
    'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
    'response.choice@1', 'response.text@1', 'response.matching@1',
    'response.region@1', 'response.asset-choice@1',
    'return.session@1',
  ],
  limits: {},
};

const incompatibleBundle = { lesson: { modules: [
  // solver@1 is a registered tool capability this profile does not offer.
  { moduleId: 'solve', type: 'tool', capability: 'solver@1', config: {} },
] } };
const unknownTypeBundle = { lesson: { modules: [
  { moduleId: 'mystery', type: 'holo_projection' },
] } };

runCertificationPortContract({
  name: 'screen', makePort: () => new ScreenCertification(),
  profile: screenProfile, renderableBundle, incompatibleBundle, unknownTypeBundle,
});

describe('ScreenCertification specifics (spec §6.4)', () => {
  const port = new ScreenCertification();

  it('demotes region_click items on a pointer-less profile', () => {
    const remoteOnly = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => c !== 'response.region@1') };
    const bank = { id: 'b', items: [{ id: 'q1', type: 'region_click', prompt: 'p', asset: 'map', answer: 'x' }] };
    const result = port.certify({ lesson: { modules: [{ moduleId: 'm', type: 'quiz', bank }] } }, remoteOnly);
    expect(result.modules[0].reasons.join()).toMatch(/response\.region@1/);
  });

  it('requires return.session@1 for tracked modules', () => {
    const noReturn = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => !c.startsWith('return.')) };
    const result = port.certify(renderableBundle, noReturn);
    expect(result.modules.find((m) => m.moduleId === 'check').reasons.join()).toMatch(/return\.session@1/);
    expect(result.modules.find((m) => m.moduleId === 'notes').verdict).toBe('render');
  });

  it('certifies a standalone bank against the profile', () => {
    const bank = { id: 'b', items: [{ id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' }] };
    expect(port.certifyBank(bank, screenProfile).verdict).toBe('render');
    const noText = { ...screenProfile, capabilities: screenProfile.capabilities.filter((c) => c !== 'response.text@1') };
    expect(port.certifyBank(bank, noText).verdict).toBe('incompatible');
  });
});
