import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { createTi86StringFile } from './lib/ti86-string-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'ti86.cli.mjs');

describe('ti86.cli adaptive result inspection', () => {
  it('decodes a retained DSQ.86s without an emulator or ROM', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ti86-cli-result-'));
    try {
      const record = encodeTi86ResultRecord({
        schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001',
        sequence: 41, learnerKey: 4, artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
        responses: [{ itemIndex: 0, given: 1 }, { itemIndex: 1, given: 3 }],
        localScore: { correct: 1, total: 2, percent: 50, basis: 'embedded_answer_key' },
        adaptiveStudy: {
          sessionCode: '001234',
          cards: [
            { rating: 'again', exposureCount: 2 },
            { rating: 'hard', exposureCount: 4 },
            { rating: 'know', exposureCount: 1 },
          ],
          quizChoices: [1, 3],
        },
      });
      const queue = encodeTi86ResultQueue({ deviceId: '86A001', records: [record] });
      const file = path.join(directory, 'DSQ.86s');
      writeFileSync(file, createTi86StringFile({ name: 'DSQ', record: queue }));
      const output = execFileSync(process.execPath, [CLI, '--inspect-result-file', file], {
        encoding: 'utf8',
      });
      expect(output).toContain('sessionCode=001234');
      expect(output).toContain('cards=0:AGAIN/2,1:HARD/4,2:KNOW/1');
      expect(output).toContain('quizChoices=A,C score=1/2 percent=50');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
