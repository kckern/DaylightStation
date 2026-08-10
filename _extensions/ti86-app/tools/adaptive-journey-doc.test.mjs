import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { normalizeTi86MameScenario } from './lib/ti86-mame-scenario.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('Adaptive Study emulator journey documentation', () => {
  it('defines the complete code-to-QR key journey', () => {
    const specification = parseYaml(readFileSync(path.join(HERE, '..', 'testing', 'adaptive-journey.yml'), 'utf8'));
    const scenario = normalizeTi86MameScenario(specification.scenarios[0]);
    expect(scenario.id).toBe('adaptive-v1-journey');
    expect(scenario.steps.map(({ capture }) => capture)).toEqual([
      '01-enter-code', '02-first-digit', '03-second-digit', '04-third-digit',
      '05-fourth-digit', '06-fifth-digit', '07-code-ready', '08-graphic-card-front',
      '09-graphic-card-back', '10-study-summary', '11-quiz-prompt',
      '12-quiz-choices', '13-durable-result', '14-result-qr',
    ]);
    expect(scenario.steps.at(-1).expectSymbols).toEqual(['QR V5/M']);
  });

  it('compiles report frames into digest-bearing standalone HTML', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-journey-doc-'));
    const frames = path.join(directory, 'adaptive-v1-journey');
    mkdirSync(frames);
    writeFileSync(path.join(frames, '01-enter-code.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    writeFileSync(path.join(directory, 'report.json'), JSON.stringify({
      schema: 'schoolcalc.ti86-mame-scenario-report/v1', releaseId: 'release123',
      rom: { version: '1.4', sha1: 'abc123' },
      scenarios: [{
        id: 'adaptive-v1-journey', description: 'Exact journey',
        frames: [{ capture: '01-enter-code', pc: 'D748', sha256: 'frame123', fileName: '01-enter-code.png' }],
      }],
    }));
    const output = path.join(directory, 'docs', 'journey.html');
    execFileSync(process.execPath, [path.join(HERE, 'build-adaptive-journey-doc.mjs'),
      '--report', path.join(directory, 'report.json'), '--output', output]);
    const html = readFileSync(output, 'utf8');
    expect(html).toContain('Exact TI-86 / MAME evidence');
    expect(html).toContain('MAME PASS');
    expect(html).toContain('scenario adaptive-v1-journey');
    expect(html).toContain('passed every configured text, transition, and Version-5/M QR assertion');
    expect(html).toContain('release release123');
    expect(html).toContain('ROM SHA-1 abc123');
    expect(html).toContain('frame SHA-256 frame123');
    expect(readFileSync(path.join(directory, 'docs', 'adaptive-study-journey', '01-01-enter-code.png')))
      .toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
  });
});
