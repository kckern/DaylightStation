import { sectionToRange } from './focusRange.js';

const DEFAULT_SIZING = Object.freeze({ targetMeasures: 4, minMeasures: 3, maxMeasures: 5 });

function partsInRange(steps, measures, start, end) {
  const parts = new Set();
  for (let measureIndex = start; measureIndex <= end; measureIndex += 1) {
    const measure = measures[measureIndex];
    if (!measure) continue;
    for (let stepIndex = measure.firstStep; stepIndex <= measure.lastStep; stepIndex += 1) {
      for (const note of steps?.[stepIndex]?.notes ?? []) {
        const staff = Number.isInteger(note.staff) ? note.staff : 0;
        parts.add(staff === 0 ? 'rh' : staff === 1 ? 'lh' : `p${staff + 1}`);
      }
    }
  }
  return [...parts];
}

function balancedRanges(start, end, sizing) {
  const count = end - start + 1;
  if (count <= sizing.maxMeasures) return [[start, end]];
  const minimumChunks = Math.max(1, Math.ceil(count / sizing.maxMeasures));
  const maximumChunks = Math.max(1, Math.floor(count / sizing.minMeasures));
  const targetChunks = Math.max(1, Math.round(count / sizing.targetMeasures));
  const chunks = minimumChunks <= maximumChunks
    ? Math.max(minimumChunks, Math.min(targetChunks, maximumChunks))
    : minimumChunks;
  const base = Math.floor(count / chunks);
  const remainder = count % chunks;
  const result = [];
  let cursor = start;
  for (let index = 0; index < chunks; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    result.push([cursor, cursor + size - 1]);
    cursor += size;
  }
  return result;
}

function sectionRegions(sections, measures) {
  const mapped = (sections ?? [])
    .map((section) => ({ ...sectionToRange(section, measures), label: section.label }))
    .filter((section) => Number.isInteger(section.inMeasure) && Number.isInteger(section.outMeasure))
    .sort((a, b) => a.inMeasure - b.inMeasure);
  if (!mapped.length) return measures.length ? [{ inMeasure: 0, outMeasure: measures.length - 1, label: null }] : [];

  const regions = [];
  let cursor = 0;
  for (const section of mapped) {
    if (section.inMeasure > cursor) regions.push({ inMeasure: cursor, outMeasure: section.inMeasure - 1, label: null });
    regions.push(section);
    cursor = section.outMeasure + 1;
  }
  if (cursor < measures.length) regions.push({ inMeasure: cursor, outMeasure: measures.length - 1, label: null });
  return regions;
}

export function buildLearnPassages({ sections = [], measures = [], steps = [], passages = DEFAULT_SIZING } = {}) {
  const sizing = { ...DEFAULT_SIZING, ...(passages || {}) };
  const result = [];
  for (const region of sectionRegions(sections, measures)) {
    for (const [inMeasure, outMeasure] of balancedRanges(region.inMeasure, region.outMeasure, sizing)) {
      const playableParts = partsInRange(steps, measures, inMeasure, outMeasure);
      if (!playableParts.length) continue;
      result.push({
        id: `m${inMeasure}-${outMeasure}`,
        order: result.length + 1,
        label: region.label ? `${region.label} · ${measures[inMeasure]?.number}–${measures[outMeasure]?.number}` : `Bars ${measures[inMeasure]?.number}–${measures[outMeasure]?.number}`,
        section: region.label ?? null,
        inMeasure,
        outMeasure,
        printedMeasures: [measures[inMeasure]?.number, measures[outMeasure]?.number],
        playableParts,
      });
    }
  }
  return result;
}

export function applicableLearnLadder(ladder = [], playableParts = []) {
  const available = new Set(playableParts);
  const singlePart = available.size < 2;
  return ladder.flatMap((rung) => {
    const requested = rung.parts ?? [];
    if (rung.scope === 'all-parts') return [{ ...rung, effectiveParts: [...available] }];
    if (singlePart && requested.length === 1) return [];
    const effectiveParts = singlePart ? [...available] : requested.filter((part) => available.has(part));
    if (!effectiveParts.length || (!singlePart && effectiveParts.length !== requested.length)) return [];
    return [{ ...rung, effectiveParts }];
  });
}

export function projectLearnPassage({ passage, ladder = [], progress = {} } = {}) {
  const applicable = applicableLearnLadder(ladder, passage?.playableParts ?? []);
  let sequentialOpen = true;
  const rungs = applicable.map((rung) => {
    const required = rung.sets * rung.reps;
    const passCount = Math.min(Math.max(0, progress?.rungs?.[rung.id]?.passCount ?? 0), required);
    const complete = passCount >= required || progress?.testedOut === true;
    let state;
    if (complete) state = 'complete';
    else if (rung.availability === 'always') state = 'available';
    else if (sequentialOpen) { state = 'current'; sequentialOpen = false; }
    else state = 'locked';
    return { ...rung, passCount, required, state };
  });
  return { ...passage, complete: progress?.complete === true || progress?.testedOut === true, testedOut: progress?.testedOut === true, rungs };
}

export default { buildLearnPassages, applicableLearnLadder, projectLearnPassage };
