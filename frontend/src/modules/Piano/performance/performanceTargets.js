import { buildTempoMap, msAtQuarter } from '../../MusicNotation/scoreTimeline.js';

const onsetKey = (quarter) => Number(quarter || 0).toFixed(6);

/**
 * Compile renderer-independent score notes into timed performance targets.
 * Tempo is resolved here; the judge only deals in milliseconds.
 */
export function buildPerformanceTargets(notes, options = {}) {
  const tempoMap = options.tempoMap || buildTempoMap([], options.fallbackBpm || 90);
  const timeScale = Number.isFinite(options.timeScale) && options.timeScale > 0 ? options.timeScale : 1;
  const leadInMs = Number.isFinite(options.leadInMs) ? options.leadInMs : 0;
  const minDurationMs = Number.isFinite(options.minDurationMs) ? options.minDurationMs : 90;
  const isExpected = options.isExpected || (() => true);
  const groups = new Map();

  for (const note of notes || []) {
    if (!note || note.rest || !Number.isFinite(note.midi) || !isExpected(note)) continue;
    if (note.tie === 'stop' || note.tie === 'both') continue;
    const key = onsetKey(note.onsetQuarter);
    const group = groups.get(key) || {
      onsetQuarter: Number(note.onsetQuarter) || 0,
      pitches: new Set(),
      staves: new Set(),
      measures: new Set(),
      durationQuarters: 0,
    };
    group.pitches.add(note.midi);
    if (note.staff != null) group.staves.add(note.staff);
    const measureIndex = note.measureIndex ?? note.measure;
    if (Number.isFinite(measureIndex)) group.measures.add(measureIndex);
    group.durationQuarters = Math.max(group.durationQuarters, Number(note.durationQuarters) || 0);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter)
    .map((group, index) => {
      const onsetMs = msAtQuarter(tempoMap, group.onsetQuarter) * timeScale;
      const offMs = msAtQuarter(tempoMap, group.onsetQuarter + group.durationQuarters) * timeScale;
      const measures = [...group.measures].sort((a, b) => a - b);
      return {
        id: index + 1,
        onsetQuarter: group.onsetQuarter,
        pitches: [...group.pitches].sort((a, b) => a - b),
        staves: [...group.staves].sort((a, b) => a - b),
        measureIndex: measures.length === 1 ? measures[0] : null,
        targetTimeMs: leadInMs + onsetMs,
        durationMs: Math.max(minDurationMs, offMs - onsetMs),
      };
    });
}

export default { buildPerformanceTargets };
