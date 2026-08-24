import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { YamlDrawingCheckpointRepository } from './YamlDrawingCheckpointRepository.mjs';

describe('YamlDrawingCheckpointRepository', () => {
  it('stores active drawing state outside the journal and deletes it physically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawing-checkpoint-')); const repository = new YamlDrawingCheckpointRepository({ checkpointsDir: dir });
    const checkpoint = { strokes: [{ ink: '#112233', width: 4, eraser: false, points: [{ x: 1, y: 2, pressure: .5 }] }] };
    await repository.put('game:one', checkpoint); expect(await repository.get('game:one')).toEqual(checkpoint);
    expect(await repository.delete('game:one')).toBe(true); expect(await repository.get('game:one')).toEqual({ strokes: [] });
  });

  it('fails closed on oversized or malformed point data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawing-checkpoint-')); const repository = new YamlDrawingCheckpointRepository({ checkpointsDir: dir });
    await expect(repository.put('game:one', { strokes: [{ ink: 'red', width: 4, points: [] }] })).rejects.toThrow('invalid stroke');
    await expect(repository.put('game:one', { strokes: Array.from({ length: 501 }, () => ({})) })).rejects.toThrow('at most 500');
  });
});
