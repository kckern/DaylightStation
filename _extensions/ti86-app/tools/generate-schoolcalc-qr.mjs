#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import {
  createSchoolCalcQrFrame,
  toAssemblyInclude,
  TI86_FRAME_HEIGHT,
  TI86_FRAME_WIDTH,
} from './lib/schoolcalc-qr.mjs';
import { encodeTi86ResultRecord } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const example = valueAfter('--example');
const payload = valueAfter('--payload') ?? examplePayload(example);
const output = path.resolve(valueAfter('--output') ?? `schoolcalc-${example ?? 'qr'}.png`);
const includeOutput = valueAfter('--include');
const previewScale = Number(valueAfter('--preview-scale') ?? 4);
if (!payload || !Number.isInteger(previewScale) || previewScale < 1 || previewScale > 16) {
  throw new Error('usage: generate-schoolcalc-qr.mjs (--payload TEXT | --example action|max-result) [--output PNG] [--include INC]');
}

const frame = createSchoolCalcQrFrame(payload);
const canvas = createCanvas(TI86_FRAME_WIDTH * previewScale, TI86_FRAME_HEIGHT * previewScale);
const context = canvas.getContext('2d');
context.fillStyle = '#cbd4ad';
context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = '#17251c';
frame.rows.forEach((row, y) => [...row].forEach((cell, x) => {
  if (cell === '█') context.fillRect(x * previewScale, y * previewScale, previewScale, previewScale);
}));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, canvas.toBuffer('image/png'));
if (includeOutput) {
  const includePath = path.resolve(includeOutput);
  fs.mkdirSync(path.dirname(includePath), { recursive: true });
  fs.writeFileSync(includePath, toAssemblyInclude(frame));
}
console.log(
  `Rendered SchoolCalc ${frame.kind} QR V${frame.version}/${frame.errorCorrectionLevel} `
  + `(${frame.occupiedPixels}x${frame.occupiedPixels} within full 128x64 canvas) to ${output}`,
);

function examplePayload(name) {
  if (name === 'action') return 'sch:2K7QVM4X9HRJTBNP';
  if (name === 'max-result') {
    return encodeTi86ResultRecord({
      schema: 'school.calc.result/v1',
      kind: 'responses',
      deviceId: '86A001',
      learnerKey: 4,
      sequence: 18,
      artifactId: 'sc:ti86:ABC234DEFG',
      moduleIndex: 0,
      responses: Array.from({ length: 238 }, (_, itemIndex) => ({
        itemIndex,
        given: (itemIndex % 5) + 1,
      })),
      localScore: { correct: 48, total: 238, percent: 20 },
    }, { qrText: true });
  }
  return null;
}
