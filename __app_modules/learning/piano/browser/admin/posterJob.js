/**
 * Making and uploading generated posters: one from the engraving already on the
 * score page, or a walk over every score without a poster in a hidden host.
 */
import { buildHeaders } from "../../../../../frontend/src/lib/api.mjs";
import { extractPerStaffGeometry } from "../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js";
import { posterCrop, posterSvg, POSTER_SYSTEMS } from "./posterSvg.js";

const POSTER_PATH = '/api/v1/admin/sheet-music/poster';
/** Engraving width and zoom for posters made off-screen, close to the score page's. */
export const POSTER_ENGRAVE_WIDTH = 1000;
export const POSTER_ENGRAVE_SCALE = 0.8;

/** Readable copy for the codes making or uploading a poster can end with. */
export const POSTER_ERROR_MESSAGES = {
  'has-scan': 'This score has a scanned poster, which the kiosk shows instead.',
  'poster-exists': 'A hand-made SVG poster already sits beside this score; it was left alone.',
  'too-large': 'The poster came out over 300 KB.',
  'no-svg': 'The score has not been engraved yet.',
  'no-xml': 'The score file could not be loaded.',
  'engrave-failed': 'The score could not be engraved.',
  network: 'The server could not be reached.',
};

/** A poster (svg text and size) from an engraved `<svg>` and its per-staff geometry. */
export function posterFromEngraving({ svg, staffBoxes, systems = POSTER_SYSTEMS }) {
  return posterSvg(svg, posterCrop(staffBoxes, { systems }));
}

/**
 * POSTs the svg text. Resolves `{ ok: true, result }` on 201, else
 * `{ ok: false, code, status }` (`code` is null when the body had none).
 */
export async function uploadPoster(id, text) {
  let response;
  try {
    response = await fetch(`${POSTER_PATH}?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...buildHeaders(localStorage.getItem('ds_token'), false), 'Content-Type': 'image/svg+xml' },
      body: text,
    });
  } catch (err) {
    return { ok: false, code: 'network', status: 0, message: err?.message };
  }
  let doc = null;
  try { doc = await response.json(); } catch { doc = null; }
  if (response.ok) return { ok: true, result: doc || {} };
  return { ok: false, code: typeof doc?.error === 'string' ? doc.error : null, status: response.status };
}

const stepError = (code, message) => Object.assign(new Error(message || code), { code });

/**
 * Generates and uploads a poster for each row, strictly one at a time in `host`
 * (one engraving at once). Each failure is recorded and the walk goes on.
 * `isCancelled()` is checked between scores and inside the engraving.
 *
 * @param {{ rows: Array<{id:string}>, host: HTMLElement, fetchXml: (id) => Promise<string>,
 *   engrave: Function, upload?: Function, onProgress?: Function, isCancelled?: () => boolean, logger?: object }} opts
 *   `engrave` is osmdEngrave's signature: `(host, xml, opts) → { osmd } | null`.
 * @returns {Promise<{ saved: string[], failed: Array<{id, code}>, cancelled: boolean }>}
 */
export async function generateMissingPosters({
  rows, host, fetchXml, engrave, upload = uploadPoster, onProgress, isCancelled = () => false, logger,
}) {
  const saved = [];
  const failed = [];
  const total = rows.length;
  for (let index = 0; index < total; index += 1) {
    if (isCancelled()) {
      logger?.info?.('admin.sheetmusic.posters-cancelled', { done: index, total });
      return { saved, failed, cancelled: true };
    }
    const { id } = rows[index];
    onProgress?.({ index, total, id });
    try {
      let xml;
      try { xml = await fetchXml(id); } catch (err) { throw stepError('no-xml', err?.message); }
      let engraved;
      try {
        engraved = await engrave(host, xml, {
          flow: 'wrapped', scale: POSTER_ENGRAVE_SCALE, width: POSTER_ENGRAVE_WIDTH, shouldAbort: isCancelled,
        });
      } catch (err) {
        throw stepError('engrave-failed', err?.message);
      }
      if (!engraved) continue; // aborted; the loop head reports the cancel
      const { text, bytes } = posterFromEngraving({
        svg: host.querySelector('svg'), staffBoxes: extractPerStaffGeometry(engraved.osmd),
      });
      const outcome = await upload(id, text);
      if (!outcome.ok) throw stepError(outcome.code || `http-${outcome.status}`);
      saved.push(id);
      logger?.info?.('admin.sheetmusic.poster-generated', { id, bytes, bulk: true });
    } catch (err) {
      const code = err?.code || 'failed';
      failed.push({ id, code });
      logger?.warn?.('admin.sheetmusic.poster-failed', { id, code, bulk: true, error: err?.message });
    } finally {
      host.innerHTML = '';
    }
  }
  onProgress?.({ index: total, total, id: null });
  return { saved, failed, cancelled: false };
}
