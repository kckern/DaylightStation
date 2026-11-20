/**
 * ProposeLearnSegments — the Jev boundary scorer for Learn segment proposals.
 *
 * The admin browser sends one feature record per barline (phraseSegments'
 * barlineFeatures) and a PNG crop of the bars either side of each barline, with
 * the barline marked. Jev answers one yes/no per barline: does a phrase end here?
 * Its probability is p for that barline; rehearsal-section starts are certain
 * cuts (p = 1) and are never sent. The same partitionSegments as the heuristic
 * (length prior included) turns p into segments.
 *
 * - Batches of JEV_BATCH_SIZE barlines per evaluate(), CONCURRENCY at once.
 * - A rate-limited batch (error with `retryAfter`, seconds) waits once on the injected
 *   scheduler and retries; without a scheduler it fails like any other error.
 * - A barline whose batch failed, or that came back without an answer, gets p 0.5.
 *   More than MAX_FAILED_SHARE of the barlines sent failing throws
 *   `{ code: 'proposal-failed' }`: cuts that only look model-made are worse than none.
 * - With `reference` segments (a grown-up's approved cuts), the result carries a
 *   `comparison` of Jev's and the heuristic's cuts against them — the calibration
 *   gate's evidence (spec §5), logged as `piano.sheetmusic.propose.compared`.
 *
 * Logs `piano.sheetmusic.propose.start|done|failed` with calls, failures, ms, model.
 * Layer: APPLICATION. The gateway (IDecisionGateway) is injected.
 */
import { image, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import {
  boundaryAgreement, boundaryProbabilities, compactFeatures, FEATURE_KEYS, partitionSegments,
} from '../../portable/music/phraseSegments.mjs';

export const JEV_BATCH_SIZE = 10;
export const CONCURRENCY = 2;
export const MAX_FAILED_SHARE = 0.2;
const MAX_RETRY_WAIT_MS = 60_000;
const LIMITS = Object.freeze({ minLen: 2, maxLen: 8, targetLen: 4 });

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngDimensions(data) {
  if (!data || data.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => data[i] === b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const question = (key) => yesNo(
  `Does a musical phrase end at the barline marked with a red triangle in \`${key}\`?`,
  {
    yes: 'A listener would breathe at that barline: a cadence, a rest or a long note closes a musical idea there.',
    no: 'The melody or rhythm carries straight across that barline into the next bar.',
  },
);

function codedError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

const round3 = (p) => Math.round(p * 1000) / 1000;

export class ProposeLearnSegments {
  #gateway;
  #logger;
  #now;
  #scheduler;

  /**
   * @param {{ gateway: object, logger?: object, now?: () => Date, scheduler?: { wait: (ms:number) => Promise<void> } }} deps
   */
  constructor({ gateway, logger = null, now = () => new Date(), scheduler = null } = {}) {
    if (!gateway || typeof gateway.evaluate !== 'function') throw new Error('ProposeLearnSegments requires gateway');
    this.#gateway = gateway;
    this.#logger = logger;
    this.#now = now;
    this.#scheduler = scheduler && typeof scheduler.wait === 'function' ? scheduler : null;
  }

  /**
   * @param {{ id: string, features: Array<object>, crops: Map<number, Buffer>, measureCount: number,
   *   limits?: { minLen?: number, maxLen?: number, targetLen?: number }, reference?: Array<{start,end}> }} input
   *   `features` are barlineFeatures records, one per barline (after = 0..measureCount-2).
   * @returns {Promise<{ segments: Array<{start,end}>, proposal: object, comparison?: object }>}
   */
  async execute({ id, features, crops, measureCount, limits = {}, reference = null }) {
    const started = Date.now();
    const records = [...features].sort((a, b) => a.after - b.after);
    const asked = records.filter((f) => !f.sectionStart).map((f) => f.after);
    const batches = [];
    for (let i = 0; i < asked.length; i += JEV_BATCH_SIZE) batches.push(asked.slice(i, i + JEV_BATCH_SIZE));
    this.#logger?.info?.('piano.sheetmusic.propose.start', { id, barlines: asked.length, calls: batches.length });

    const p = new Map();
    let failedCalls = 0;
    let calls = 0;
    let model = null;
    const byAfter = new Map(records.map((f) => [f.after, f]));

    const runBatch = async (keys) => {
      const state = { features: keys.map((k) => byAfter.get(k)) };
      const questions = {};
      for (const k of keys) {
        const data = crops.get(k);
        const size = pngDimensions(data);
        state[`bar_${k}`] = image(data, { mediaType: 'image/png', ...(size || {}) });
        questions[`bar_${k}`] = question(`bar_${k}`);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          calls += 1;
          const result = await this.#gateway.evaluate(state, questions);
          model = model ?? result?.model ?? null;
          for (const k of keys) {
            const prob = result?.answers?.[`bar_${k}`]?.probability;
            if (Number.isFinite(prob)) p.set(k, Math.min(1, Math.max(0, prob)));
          }
          return;
        } catch (error) {
          const retryAfter = Number(error?.retryAfter);
          if (attempt === 0 && this.#scheduler && Number.isFinite(retryAfter) && retryAfter >= 0) {
            this.#logger?.warn?.('piano.sheetmusic.propose.rate-limited', { id, retryAfter });
            await this.#scheduler.wait(Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS));
            continue;
          }
          failedCalls += 1;
          this.#logger?.warn?.('piano.sheetmusic.propose.call-failed', { id, barlines: keys.length, error: error?.message, code: error?.code ?? null });
          return;
        }
      }
      failedCalls += 1;
    };

    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next];
        next += 1;
        await runBatch(batch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const failures = asked.filter((k) => !p.has(k)).length;
    const ms = Date.now() - started;
    if (asked.length && failures / asked.length > MAX_FAILED_SHARE) {
      this.#logger?.error?.('piano.sheetmusic.propose.failed', { id, failures, barlines: asked.length, calls, ms, model });
      throw codedError('proposal-failed', `Jev failed on ${failures} of ${asked.length} barlines`, { failures, barlines: asked.length });
    }

    const pAfter = new Map(records.map((f) => [f.after, f.sectionStart ? 1 : (p.get(f.after) ?? 0.5)]));
    const opts = { ...LIMITS, ...limits };
    const segments = partitionSegments(measureCount, pAfter, opts);
    const proposal = {
      scorer: 'jev',
      model,
      at: this.#now().toISOString(),
      boundaries: Object.fromEntries([...pAfter].map(([k, v]) => [k, round3(v)])),
      failedCalls,
      failedBarlines: failures,
      featureKeys: [...FEATURE_KEYS],
      features: compactFeatures(records),
    };
    this.#logger?.info?.('piano.sheetmusic.propose.done', { id, calls, failures, ms, model, segments: segments.length });

    let comparison;
    if (Array.isArray(reference) && reference.length) {
      const heuristic = partitionSegments(measureCount, boundaryProbabilities(records), opts);
      comparison = { jev: boundaryAgreement(segments, reference), heuristic: boundaryAgreement(heuristic, reference) };
      this.#logger?.info?.('piano.sheetmusic.propose.compared', {
        id, model,
        jevPrecision: comparison.jev.precision, jevRecall: comparison.jev.recall,
        heuristicPrecision: comparison.heuristic.precision, heuristicRecall: comparison.heuristic.recall,
      });
    }
    return { segments, proposal, ...(comparison ? { comparison } : {}) };
  }
}

export default ProposeLearnSegments;
