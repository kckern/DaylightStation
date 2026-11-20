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
 * - Batches of JEV_BATCH_SIZE barlines per evaluate(), CONCURRENCY at once, each
 *   call with a CALL_TIMEOUT_MS timeout. Each image `bar_<k>` comes with its
 *   numeric measurements as `bar_<k>_features`.
 * - A rate-limited batch (error with `retryAfter`, seconds) waits once on the
 *   injected scheduler and retries, unless the wait is over MAX_RETRY_WAIT_MS (or
 *   there is no scheduler): then the batch fails.
 * - No batch starts after DEADLINE_MS, or once `signal` is aborted (the admin left):
 *   an aborted run throws `{ code: 'aborted' }` and spends nothing more.
 * - A barline whose batch failed, was never sent, or came back without an answer
 *   gets p 0.5. More than MAX_FAILED_SHARE of the barlines failing throws
 *   `{ code: 'proposal-failed' }`: cuts that only look model-made are worse than none.
 * - With `reference` segments (a grown-up's hand-cut approved segments), the result
 *   carries a `comparison` of Jev's and the heuristic's boundaries against them —
 *   the calibration gate's evidence (spec §5), logged as `piano.sheetmusic.propose.compared`.
 *
 * Logs `piano.sheetmusic.propose.start|done|failed|aborted` with calls, failures, ms, model.
 * Layer: APPLICATION. The gateway (IDecisionGateway) and scheduler are injected.
 */
import { image, yesNo } from '#apps/common/ports/IDecisionGateway.mjs';
import {
  boundaryAgreement, boundaryProbabilities, compactFeatures, FEATURE_KEYS, partitionSegments,
} from '../../portable/music/phraseSegments.mjs';

export const JEV_BATCH_SIZE = 10;
export const CONCURRENCY = 2;
export const MAX_FAILED_SHARE = 0.2;
export const CALL_TIMEOUT_MS = 30_000;
export const MAX_RETRY_WAIT_MS = 15_000;
export const DEADLINE_MS = 75_000;
const LIMITS = Object.freeze({ minLen: 2, maxLen: 8, targetLen: 4 });

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngDimensions(data) {
  if (!data || data.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => data[i] === b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A feature record cut to the known measurements (no `after`), finite numbers and booleans only. */
export function measurementsOf(record) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    if (key === 'after') continue;
    const v = record?.[key];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v;
  }
  return out;
}

const question = (key) => yesNo(
  `Does a musical phrase end at the barline marked with a red triangle in \`${key}\`? `
    + `\`${key}_features\` has measurements at that barline (tailGapRatio: how much of the bar the last note `
    + 'or rest takes; bassMotion: semitones the bass moves across it).',
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
  #nowMs;
  #scheduler;
  #deadlineMs;

  /**
   * @param {{ gateway: object, logger?: object, now?: () => Date, nowMs?: () => number,
   *   scheduler?: { wait: (ms:number) => Promise<void> }, deadlineMs?: number }} deps
   */
  constructor({ gateway, logger = null, now = () => new Date(), nowMs = null, scheduler = null, deadlineMs = DEADLINE_MS } = {}) {
    if (!gateway || typeof gateway.evaluate !== 'function') throw new Error('ProposeLearnSegments requires gateway');
    this.#gateway = gateway;
    this.#logger = logger;
    this.#now = now;
    this.#nowMs = typeof nowMs === 'function' ? nowMs : () => now().getTime();
    this.#scheduler = scheduler && typeof scheduler.wait === 'function' ? scheduler : null;
    this.#deadlineMs = deadlineMs;
  }

  /**
   * @param {{ id: string, features: Array<object>, crops: Map<number, Buffer>, measureCount: number,
   *   limits?: { minLen?: number, maxLen?: number, targetLen?: number }, reference?: Array<{start,end}>,
   *   signal?: AbortSignal }} input
   *   `features` are barlineFeatures records, one per barline (after = 0..measureCount-2).
   * @returns {Promise<{ segments: Array<{start,end}>, proposal: object, comparison?: object }>}
   */
  async execute({ id, features, crops, measureCount, limits = {}, reference = null, signal = null }) {
    const started = this.#nowMs();
    const records = [...features].sort((a, b) => a.after - b.after);
    const asked = records.filter((f) => !f.sectionStart).map((f) => f.after);
    const batches = [];
    for (let i = 0; i < asked.length; i += JEV_BATCH_SIZE) batches.push(asked.slice(i, i + JEV_BATCH_SIZE));
    this.#logger?.info?.('piano.sheetmusic.propose.start', { id, barlines: asked.length, calls: batches.length });

    const p = new Map();
    let calls = 0;
    let failedCalls = 0;
    let skippedCalls = 0;
    let model = null;
    const byAfter = new Map(records.map((f) => [f.after, f]));
    const stopped = () => Boolean(signal?.aborted);
    const late = () => this.#nowMs() - started > this.#deadlineMs;

    const runBatch = async (keys) => {
      const state = {};
      const questions = {};
      for (const k of keys) {
        const data = crops.get(k);
        const size = pngDimensions(data);
        state[`bar_${k}`] = image(data, { mediaType: 'image/png', ...(size || {}) });
        state[`bar_${k}_features`] = measurementsOf(byAfter.get(k));
        questions[`bar_${k}`] = question(`bar_${k}`);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          calls += 1;
          const result = await this.#gateway.evaluate(state, questions, { timeout: CALL_TIMEOUT_MS });
          model = model ?? result?.model ?? null;
          for (const k of keys) {
            const prob = result?.answers?.[`bar_${k}`]?.probability;
            if (Number.isFinite(prob)) p.set(k, Math.min(1, Math.max(0, prob)));
          }
          return;
        } catch (error) {
          const retryAfter = error?.retryAfter != null ? Number(error.retryAfter) : NaN;
          const waitMs = retryAfter * 1000;
          const canWait = attempt === 0 && this.#scheduler && Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= MAX_RETRY_WAIT_MS;
          if (canWait && !stopped()) {
            this.#logger?.warn?.('piano.sheetmusic.propose.rate-limited', { id, retryAfter });
            await this.#scheduler.wait(waitMs);
            if (!stopped() && !late()) continue;
          }
          failedCalls += 1;
          this.#logger?.warn?.('piano.sheetmusic.propose.call-failed', { id, barlines: keys.length, error: error?.message, code: error?.code ?? null, retryAfter: Number.isFinite(retryAfter) ? retryAfter : null });
          return;
        }
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        if (stopped() || late()) { skippedCalls = batches.length - next; next = batches.length; return; }
        const batch = batches[next];
        next += 1;
        await runBatch(batch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    const ms = this.#nowMs() - started;
    if (stopped()) {
      this.#logger?.warn?.('piano.sheetmusic.propose.aborted', { id, calls, ms, model });
      throw codedError('aborted', 'The admin left before the proposal finished');
    }
    const failures = asked.filter((k) => !p.has(k)).length;
    if (asked.length && failures / asked.length > MAX_FAILED_SHARE) {
      this.#logger?.error?.('piano.sheetmusic.propose.failed', { id, failures, barlines: asked.length, calls, skippedCalls, ms, model });
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
    this.#logger?.info?.('piano.sheetmusic.propose.done', { id, calls, failures, skippedCalls, ms, model, segments: segments.length });

    let comparison;
    if (Array.isArray(reference) && reference.length) {
      const heuristic = partitionSegments(measureCount, boundaryProbabilities(records), opts);
      comparison = {
        jev: boundaryAgreement(segments, reference, measureCount),
        heuristic: boundaryAgreement(heuristic, reference, measureCount),
        heuristicSegments: heuristic,
      };
      this.#logger?.info?.('piano.sheetmusic.propose.compared', {
        id, model,
        jevPrecision: comparison.jev.precision, jevRecall: comparison.jev.recall,
        heuristicPrecision: comparison.heuristic.precision, heuristicRecall: comparison.heuristic.recall,
        jevRecallNear: comparison.jev.tolerant.recall, heuristicRecallNear: comparison.heuristic.tolerant.recall,
      });
    }
    return { segments, proposal, ...(comparison ? { comparison } : {}) };
  }
}

export default ProposeLearnSegments;
