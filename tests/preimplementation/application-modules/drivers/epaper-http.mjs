/** Exact optional display composition, selected before any product construction. */
import fs from 'node:fs';
import express from 'express';
import { wireRequest } from './http-wire.mjs';
const target = process.env.PRE_TARGET ?? 'baseline';
if (!['baseline', 'candidate'].includes(target)) throw new Error('UNKNOWN_EPAPER_HTTP_TARGET');
if (target === 'candidate' && !process.env.PRE_BASELINE_EVIDENCE) throw new Error('EPAPER_HTTP_BASELINE_EVIDENCE_REQUIRED');
const source = target === 'baseline' ? '../../../../backend/src/5_composition/modules/epaperApi.mjs'
  : '../../../../modules/screens/server/composition/epaperApi.mjs';
const url = new URL(source, import.meta.url);
if (!fs.existsSync(url)) throw new Error('EPAPER_HTTP_TARGET_MISSING: ' + target + ':' + source);
const { createEpaperApiRouter } = await import(url);
if (typeof createEpaperApiRouter !== 'function') throw new Error('EPAPER_HTTP_FACTORY_MISSING');
export const stamp = '2026-08-28T12:34:56.000Z';
export function epaperHttpFixture(display = null) {
  const app = express();
  app.use(express.json());
  app.use('/epaper', createEpaperApiRouter({ epaperAdapter: display,
    clock: () => new Date(stamp), logger: { info() {}, warn() {}, error() {} } }));
  return { target, request: (method, path, options) => wireRequest(app, method, '/epaper' + path, options) };
}
