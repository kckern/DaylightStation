import {
  Ti86SchoolCalcCodec,
  decodeTi86ResultQueueRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

const CHOICE_LABELS = Object.freeze(['', 'A', 'B', 'C', 'D', 'E']);
const codec = new Ti86SchoolCalcCodec();

/** Decode one retained adaptive result from the calculator's exact DSQ bytes. */
export function inspectTi86AdaptiveResultQueue(queueRecord, { index = -1 } = {}) {
  const queue = decodeTi86ResultQueueRecord(asBuffer(queueRecord, 'DSQ record'));
  if (queue.records.length === 0) throw new Error('DSQ contains no result records');
  const selectedIndex = index < 0 ? queue.records.length + index : index;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= queue.records.length) {
    throw new Error(`DSQ result index ${index} is out of range`);
  }
  const result = codec.decodeResult(queue.records[selectedIndex]);
  if (!result.adaptiveStudy) throw new Error(`DSQ result ${selectedIndex} is not an adaptive study result`);
  return Object.freeze({
    variable: 'DSQ',
    magic: 'SCQ1',
    valid: true,
    index: selectedIndex,
    recordCount: queue.records.length,
    deviceId: queue.deviceId,
    sequence: result.sequence,
    learnerKey: result.learnerKey,
    artifactId: result.artifactId,
    sessionCode: result.adaptiveStudy.sessionCode,
    attemptCount: result.adaptiveStudy.attemptCount,
    cards: Object.freeze(result.adaptiveStudy.cards.map((card, cardIndex) => Object.freeze({
      index: cardIndex,
      rating: card.rating,
      exposureCount: card.exposureCount,
    }))),
    quizChoices: Object.freeze(result.adaptiveStudy.quizChoices.map((choice) => CHOICE_LABELS[choice])),
    score: Object.freeze({
      correct: result.localScore.correct,
      total: result.localScore.total,
      percent: result.localScore.percent,
    }),
    recordBytes: queue.records[selectedIndex].length,
  });
}

export function formatTi86AdaptiveResultInspection(inspection) {
  const cards = inspection.cards
    .map(({ index, rating, exposureCount }) => `${index}:${rating.toUpperCase()}/${exposureCount}`)
    .join(',');
  return `SCHOOLCALC_RESULT variable=${inspection.variable} magic=${inspection.magic} valid=${inspection.valid}`
    + ` index=${inspection.index} recordCount=${inspection.recordCount}`
    + ` deviceId=${inspection.deviceId} sequence=${inspection.sequence} learnerKey=${inspection.learnerKey}`
    + ` artifactId=${inspection.artifactId} sessionCode=${inspection.sessionCode}`
    + ` attemptCount=${inspection.attemptCount}`
    + ` cards=${cards} quizChoices=${inspection.quizChoices.join(',')}`
    + ` score=${inspection.score.correct}/${inspection.score.total}`
    + ` percent=${inspection.score.percent} recordBytes=${inspection.recordBytes}`;
}

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`${label} must be bytes`);
}
