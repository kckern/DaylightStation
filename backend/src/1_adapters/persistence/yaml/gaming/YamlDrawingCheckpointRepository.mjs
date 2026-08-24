import fs from 'node:fs';
import path from 'node:path';

const SESSION = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const INK = /^#[a-fA-F0-9]{6}$/;

export function validateDrawingCheckpoint(checkpoint) {
  const strokes = checkpoint?.strokes;
  if (!Array.isArray(strokes) || strokes.length > 500) throw new Error('drawing checkpoint must contain at most 500 strokes');
  let points = 0;
  for (const stroke of strokes) {
    if (!stroke || typeof stroke !== 'object' || !INK.test(String(stroke.ink || '')) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 100 || !Array.isArray(stroke.points)) throw new Error('drawing checkpoint contains an invalid stroke');
    points += stroke.points.length;
    if (stroke.points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x < 0 || point.y < 0 || point.x > 4096 || point.y > 4096 || !Number.isFinite(point.pressure) || point.pressure < 0 || point.pressure > 1)) throw new Error('drawing checkpoint contains an invalid point');
  }
  if (points > 50_000) throw new Error('drawing checkpoint contains too many points');
  return { strokes: structuredClone(strokes) };
}

export class YamlDrawingCheckpointRepository {
  constructor({ checkpointsDir }) { if (!checkpointsDir) throw new Error('checkpointsDir is required'); this.checkpointsDir = checkpointsDir; fs.mkdirSync(checkpointsDir, { recursive: true }); }
  #file(sessionId) { if (!SESSION.test(String(sessionId))) throw new Error('invalid gaming session id'); return path.join(this.checkpointsDir, `${String(sessionId).replaceAll(':', '_')}.json`); }
  async get(sessionId) { const file = this.#file(sessionId); return fs.existsSync(file) ? validateDrawingCheckpoint(JSON.parse(fs.readFileSync(file, 'utf8'))) : { strokes: [] }; }
  async put(sessionId, checkpoint) { const value = validateDrawingCheckpoint(checkpoint); const file = this.#file(sessionId); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' }); fs.renameSync(temporary, file); return value; }
  async delete(sessionId) { const file = this.#file(sessionId); if (!fs.existsSync(file)) return false; fs.unlinkSync(file); return true; }
}
