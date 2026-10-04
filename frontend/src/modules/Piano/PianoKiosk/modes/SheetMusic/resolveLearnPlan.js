import sha256 from 'crypto-js/sha256.js';
import { applicableLearnLadder, buildLearnPassages } from './learnRoadmap.js';
import { resolveSheetMusicConfig, SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const isObject = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

function mergeSafe(base, override) {
  const result = isObject(base) ? { ...base } : {};
  if (!isObject(override)) return result;
  for (const key of Object.keys(override)) {
    if (BLOCKED_KEYS.has(key)) continue;
    const value = override[key];
    result[key] = isObject(value) && isObject(result[key]) ? mergeSafe(result[key], value)
      : Array.isArray(value) ? value.map((item) => (isObject(item) ? mergeSafe({}, item) : item))
      : value;
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function printed(measures, index) {
  const value = measures[index]?.number;
  return value == null || value === '' ? String(index + 1) : String(value);
}

function decorateSegment(segment, number, measures, ladder) {
  const playableParts = segment.playableParts ?? [];
  return {
    ...segment,
    number,
    label: `Segment ${number}`,
    name: typeof segment.name === 'string' && segment.name.trim() ? segment.name.trim() : null,
    barLabel: `Bars ${printed(measures, segment.inMeasure)}–${printed(measures, segment.outMeasure)}`,
    ladder: applicableLearnLadder(segment.ladder ?? ladder, playableParts),
  };
}

function generatedSegments(score, passages, ladder) {
  return buildLearnPassages({
    sections: score.sections ?? [], measures: score.measures ?? [], steps: score.steps ?? [], passages,
  }).map((segment, index) => decorateSegment(segment, index + 1, score.measures ?? [], ladder));
}

function authoredSegments(raw, score, ladder) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const measures = score.measures ?? [];
  const seen = new Set();
  const playableFor = (start, end) => {
    const parts = new Set();
    for (let measureIndex = start; measureIndex <= end; measureIndex += 1) {
      const measure = measures[measureIndex];
      for (let stepIndex = measure?.firstStep ?? 0; stepIndex <= (measure?.lastStep ?? -1); stepIndex += 1) {
        for (const note of score.steps?.[stepIndex]?.notes ?? []) {
          const staff = Number.isInteger(note.staff) ? note.staff : 0;
          parts.add(staff === 0 ? 'rh' : staff === 1 ? 'lh' : `p${staff + 1}`);
        }
      }
    }
    return [...parts];
  };
  const result = [];
  for (const item of raw) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const start = Number.isInteger(item?.start) ? item.start : item?.inMeasure;
    const end = Number.isInteger(item?.end) ? item.end : item?.outMeasure;
    if (!id || seen.has(id) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || end >= measures.length) return null;
    const playableParts = playableFor(start, end);
    if (!playableParts.length) return null;
    seen.add(id);
    const segmentLadder = Array.isArray(item.ladder) ? resolveSheetMusicConfig({ learn: { ladder: item.ladder } }).learn : null;
    if (segmentLadder?.configFallback) return null;
    const segment = {
      id, order: result.length + 1, inMeasure: start, outMeasure: end,
      printedMeasures: [measures[start]?.number, measures[end]?.number], playableParts,
      name: item.name ?? null,
      ...(segmentLadder ? { ladder: segmentLadder.ladder.map((rung) => (
        rung.mastery || rung.completion === 'tested-out' ? { ...rung, tempoPercent: 100, mastery: true } : rung
      )) } : {}),
    };
    result.push(decorateSegment(segment, result.length + 1, measures, ladder));
  }
  return result;
}

function normalizeTempoMap(score, fallbackBpm) {
  const candidates = Array.isArray(score.tempoMap) ? score.tempoMap
    : Array.isArray(score.tempoEntries) ? score.tempoEntries : [];
  const entries = candidates
    .map((entry) => ({ onsetQuarter: Number(entry?.onsetQuarter), bpm: Number(entry?.bpm) }))
    .filter((entry) => Number.isFinite(entry.onsetQuarter) && entry.onsetQuarter >= 0 && entry.bpm > 0)
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  const scoreTempo = Number(score.tempo);
  if (!entries.length && scoreTempo > 0) entries.push({ onsetQuarter: 0, bpm: scoreTempo });
  if (entries.length) {
    const deduped = [];
    for (const entry of entries) {
      if (deduped.at(-1)?.onsetQuarter === entry.onsetQuarter) deduped[deduped.length - 1] = entry;
      else deduped.push(entry);
    }
    if (deduped[0].onsetQuarter > 0) deduped.unshift({ onsetQuarter: 0, bpm: deduped[0].bpm });
    return { tempoMap: deduped, tempoSource: 'musicxml' };
  }
  return { tempoMap: [{ onsetQuarter: 0, bpm: fallbackBpm }], tempoSource: 'inferred' };
}

const behaviorRung = (rung) => ({
  id: rung.id, parts: rung.parts, effectiveParts: rung.effectiveParts, scope: rung.scope ?? null,
  mode: rung.mode, sets: rung.sets, reps: rung.reps, consecutive: rung.consecutive,
  availability: rung.availability, criteria: rung.criteria, completes: rung.completes,
  completion: rung.completion, tempoPercent: rung.tempoPercent, mastery: rung.mastery,
  tempoPercents: rung.tempoPercents,
});

/** Resolve every Learn configuration layer into the one immutable UI/runtime plan. */
export function resolveLearnPlan({ defaults = SHEET_MUSIC_DEFAULTS.learn, category, piece, user, userPiece, score = {} } = {}) {
  const merged = [defaults, category, piece, user, userPiece].reduce(mergeSafe, {});
  const normalized = resolveSheetMusicConfig({ learn: merged }).learn;
  const configuredLadder = normalized.ladder.map((rung) => ({
    ...rung,
    ...(rung.mastery || rung.completion === 'tested-out' ? { tempoPercent: 100, mastery: true } : {}),
  }));
  const defaultTestOut = configuredLadder.find((rung) => rung.id === 'test-out')
    ?? resolveSheetMusicConfig({}).learn.ladder.find((rung) => rung.id === 'test-out');
  const testOutRaw = mergeSafe(defaultTestOut, merged.testOut);
  const testOut = {
    ...resolveSheetMusicConfig({ learn: { ladder: [testOutRaw] } }).learn.ladder[0],
    id: testOutRaw.id || 'test-out', tempoPercent: 100, mastery: true,
    completion: 'tested-out', availability: 'always', completes: 'passage',
  };
  const ladder = configuredLadder.filter((rung) => rung.id !== 'test-out');
  const authored = authoredSegments(merged.segments, score, ladder);
  const segments = authored ?? generatedSegments(score, normalized.passages, ladder);
  const tempo = normalizeTempoMap(score, normalized.tempo.fallbackBpm);
  const navigation = { sequential: normalized.navigation.sequential };
  const behavior = {
    navigation,
    segments: segments.map((segment) => ({
      id: segment.id, inMeasure: segment.inMeasure, outMeasure: segment.outMeasure,
      ladder: segment.ladder.map(behaviorRung),
    })),
    ladder: ladder.map(behaviorRung), testOut: behaviorRung(testOut),
    tempoMap: tempo.tempoMap, tempoSource: tempo.tempoSource,
  };
  return Object.freeze({
    revision: sha256(JSON.stringify(stable(behavior))).toString(),
    navigation, segments, ladder, testOut, ...tempo,
    settings: { passages: normalized.passages, tempo: normalized.tempo },
    configFallback: normalized.configFallback || (Array.isArray(merged.segments) && authored == null),
  });
}

export default resolveLearnPlan;
