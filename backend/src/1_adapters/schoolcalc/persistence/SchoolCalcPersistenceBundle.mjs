import path from 'node:path';
import {
  FsSchoolCalcArtifactRepository,
  YamlSchoolCalcDeviceRepository,
  YamlSchoolCalcProgressRepository,
  YamlSchoolCalcResultLedger,
  YamlSchoolCalcStudySessionRepository,
} from './index.mjs';

export function createSchoolCalcPersistence({ stateRoot }) {
  return {
    devices: new YamlSchoolCalcDeviceRepository({ directory: path.join(stateRoot, 'devices') }),
    artifacts: new FsSchoolCalcArtifactRepository({ directory: path.join(stateRoot, 'artifacts') }),
    resultLedger: new YamlSchoolCalcResultLedger({ directory: path.join(stateRoot, 'results') }),
    progress: new YamlSchoolCalcProgressRepository({ directory: path.join(stateRoot, 'progress') }),
    studies: new YamlSchoolCalcStudySessionRepository({ directory: path.join(stateRoot, 'studies') }),
  };
}
