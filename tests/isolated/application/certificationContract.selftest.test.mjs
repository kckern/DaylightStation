import { runCertificationPortContract } from '../../_lib/school/certificationContract.mjs';
import { deriveModuleDemands, capabilityReasons, moduleVerdict, rollUpLesson }
  from '../../../backend/src/2_domains/school/surfaces/index.mjs';

const fakePort = () => ({
  certify(bundle, profile) {
    const modules = bundle.lesson.modules.map((module) => moduleVerdict({
      moduleId: module.moduleId,
      reasons: capabilityReasons(deriveModuleDemands({ module }), profile),
    }));
    return { modules, lesson: { verdict: rollUpLesson(modules) } };
  },
});

runCertificationPortContract({
  name: 'domain-primitives fake',
  makePort: fakePort,
  profile: { surfaceId: 'fake', capabilities: ['reader@1'] },
  renderableBundle: { lesson: { modules: [{ moduleId: 'notes', type: 'lecture_notes', documentId: 'd' }] } },
  incompatibleBundle: { lesson: { modules: [{ moduleId: 'g', type: 'tool', capability: 'graph@1', config: {} }] } },
});
