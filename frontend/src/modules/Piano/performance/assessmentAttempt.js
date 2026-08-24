const MODES = new Set(['free', 'metronome', 'cued']);
const MATCHERS = new Set(['cursor', 'timed', 'held']);
const TERMINAL = new Set(['completed', 'aborted', 'timeout', 'error']);
const VALUES = Object.freeze({ whole: 4, half: 2, quarter: 1, eighth: 0.5, '8th': 0.5, '16th': 0.25, sixteenth: 0.25, '32nd': 0.125 });

const unit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const median = (values) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const partForStaff = (staff) => staff === 0 ? 'rh' : staff === 1 ? 'lh' : `staff-${staff}`;
const authoredPart = (note) => note.part || (note.hand === 'right' ? 'rh' : note.hand === 'left' ? 'lh' : 'unassigned');
const noteKey = (eventId, part, midi, index) => `${eventId}-${part}-${midi}-${index}`;

function normalizeTempoMap(map, fallbackBpm) {
  const result = (map || []).map((entry) => ({ onsetQuarter: Number(entry.onsetQuarter) || 0, bpm: Number(entry.bpm) }))
    .filter((entry) => Number.isFinite(entry.bpm) && entry.bpm > 0)
    .sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  if (!result.length && Number.isFinite(Number(fallbackBpm)) && Number(fallbackBpm) > 0) result.push({ onsetQuarter: 0, bpm: Number(fallbackBpm) });
  return result;
}

export function compileAssessmentExpectation(input = {}) {
  const active = input.activeParts ? new Set(input.activeParts) : null;
  const events = (input.events || []).map((sourceEvent, eventIndex) => {
    const id = String(sourceEvent.id ?? `event-${eventIndex + 1}`);
    const notes = (sourceEvent.notes || []).map((sourceNote, noteIndex) => {
      const midi = Number(sourceNote.midi);
      if (!Number.isFinite(midi)) return null;
      const part = authoredPart(sourceNote);
      return Object.freeze({ ...sourceNote, id: String(sourceNote.id ?? noteKey(id, part, midi, noteIndex + 1)), midi, part });
    }).filter(Boolean).filter((note) => !active || active.has(note.part));
    return Object.freeze({
      ...sourceEvent,
      id,
      onsetQuarter: Number(sourceEvent.onsetQuarter) || 0,
      durationQuarters: Math.max(0, Number(sourceEvent.durationQuarters) || 0),
      spanId: sourceEvent.spanId == null ? null : String(sourceEvent.spanId),
      notes: Object.freeze(notes),
    });
  }).sort((a, b) => a.onsetQuarter - b.onsetQuarter);
  const source = Object.freeze({ kind: input.source?.kind || 'chart', id: String(input.source?.id || 'anonymous'), revision: input.source?.revision ?? null });
  const tempoMap = Object.freeze(normalizeTempoMap(input.tempoMap, input.bpm).map((entry) => Object.freeze(entry)));
  return Object.freeze({
    version: 1,
    source,
    events: Object.freeze(events),
    tempoMap,
  });
}

export function compileScoreExpectation({ notes = [], source, tempoMap, fallbackBpm, activeParts, range } = {}) {
  const groups = new Map();
  for (const scoreNote of notes) {
    if (!scoreNote || scoreNote.tie === 'stop' || scoreNote.tie === 'both') continue;
    const measure = Number(scoreNote.measureIndex ?? scoreNote.measure);
    if (range && Number.isFinite(measure) && (measure < range.start || measure > range.end)) continue;
    const onset = Number(scoreNote.onsetQuarter) || 0;
    const key = onset.toFixed(6);
    const event = groups.get(key) || { onsetQuarter: onset, durationQuarters: 0, spanId: Number.isFinite(measure) ? `measure:${measure}` : null, notes: [] };
    event.durationQuarters = Math.max(event.durationQuarters, Number(scoreNote.durationQuarters) || 0);
    if (!scoreNote.rest && Number.isFinite(Number(scoreNote.midi))) {
      const staff = Number.isInteger(scoreNote.staff) ? scoreNote.staff : 0;
      event.notes.push({ ...scoreNote, midi: Number(scoreNote.midi), part: partForStaff(staff) });
    }
    groups.set(key, event);
  }
  return compileAssessmentExpectation({ source: { kind: 'score', id: source?.id || 'score', revision: source?.revision ?? null }, events: [...groups.values()], tempoMap: normalizeTempoMap(tempoMap, fallbackBpm), activeParts });
}

export function prepareExerciseAssessment({ instance, mode = 'free', purpose = 'practice', requirement = null, activeParts } = {}) {
  if (!instance) throw new Error('prepareExerciseAssessment requires an exercise instance');
  if (!MODES.has(mode)) throw new Error(`Unsupported assessment mode: ${mode}`);
  let onsetQuarter = 0;
  const events = (instance.events || []).map((event, index) => {
    const value = event.durationQuarters ?? VALUES[event.value];
    if (mode === 'cued' && !Number.isFinite(value)) throw new Error(`Unrecognized exercise note value in cued mode: ${event.value}`);
    const durationQuarters = Number.isFinite(value) ? value : 0;
    const eventOnset = Number.isFinite(Number(event.onsetQuarter)) ? Number(event.onsetQuarter) : onsetQuarter;
    const compiled = { id: event.id ?? `event-${index + 1}`, onsetQuarter: eventOnset, durationQuarters, spanId: event.spanId ?? 'exercise:1', notes: event.notes || [] };
    onsetQuarter = Math.max(onsetQuarter, eventOnset + durationQuarters);
    return compiled;
  });
  const bpm = Number(requirement?.gates?.pace?.target_bpm ?? instance.tempo?.start_bpm);
  const matcher = mode === 'cued' ? 'timed' : instance.ordering === 'any' ? 'held' : 'cursor';
  if (mode === 'cued' && !(bpm > 0)) throw new Error('Cued assessment requires a usable tempo');
  if (mode !== 'cued' && requirement?.rubric?.criteria?.placement != null) throw new Error('Placement cannot be required for an untimed attempt');
  if (mode !== 'cued' && requirement?.gates?.pace) throw new Error('A pace gate requires cued mode');
  const expectation = compileAssessmentExpectation({ source: { kind: 'exercise', id: instance.id, revision: instance.revision ?? null }, events, bpm, activeParts });
  const generatedRequirement = requirement || {
    exercise_id: instance.id, mode, required_passes: 1,
    rubric: { id: 'exercise-pass-v2', version: '2', criteria: { completeness: 1, cleanliness: 1, ...(mode === 'cued' ? { placement: 0.8 } : {}) } },
    ...(mode === 'cued' ? { gates: { pace: { target_bpm: bpm } } } : {}),
  };
  return { expectation, matcher, mode, purpose, requirement: generatedRequirement };
}

function quarterToMs(map, quarter) {
  let ms = 0;
  let prior = map[0];
  if (!prior) return null;
  for (let i = 1; i < map.length && map[i].onsetQuarter < quarter; i += 1) {
    const next = map[i];
    ms += (next.onsetQuarter - prior.onsetQuarter) * 60000 / prior.bpm;
    prior = next;
  }
  return ms + (quarter - prior.onsetQuarter) * 60000 / prior.bpm;
}

function skipEmpty(events, index) {
  let cursor = index;
  while (cursor < events.length && events[cursor].notes.length === 0) cursor += 1;
  return cursor;
}

export function createAssessmentAttempt(config = {}) {
  const expectation = compileAssessmentExpectation(config.expectation || {});
  const mode = config.mode || (config.matcher === 'timed' ? 'cued' : 'free');
  const matcher = config.matcher || (mode === 'cued' ? 'timed' : 'cursor');
  if (!MODES.has(mode) || !MATCHERS.has(matcher)) throw new Error('Unsupported assessment matcher or mode');
  if (matcher === 'timed' && mode !== 'cued') throw new Error('Timed matching requires cued mode');
  if (mode === 'cued' && matcher !== 'timed') throw new Error('Cued mode requires timed matching');
  if (matcher === 'timed' && !expectation.tempoMap.length) throw new Error('Timed assessment requires a usable tempo');
  if (matcher !== 'timed' && config.requirement?.rubric?.criteria?.placement != null) throw new Error('Placement cannot be required for an untimed attempt');
  return {
    expectation, matcher, mode, purpose: config.purpose || 'practice', requirement: config.requirement || null,
    grading: config.grading || {}, policy: { matchWindowMs: 220, missWindowMs: 420, timingToleranceMs: 80, timingWindowMs: 320, wrongWindow: 24, ...config.policy },
    status: 'prepared', startedAt: null, originQuarter: 0, leadInMs: 0, clock: config.clock ?? null,
    cursor: skipEmpty(expectation.events, 0), hits: {}, wrong: [], ignored: [], misses: [], responses: [], closedSpans: [], musicalInput: false,
    heldWrongLatched: false,
  };
}

export function startAssessmentAttempt(attempt, { time, originQuarter = 0, leadInMs = 0, clock = null } = {}) {
  if (attempt.status !== 'prepared') return attempt;
  if (!Number.isFinite(time)) throw new Error('Assessment start requires a numeric time');
  return { ...attempt, status: 'running', startedAt: time, originQuarter, leadInMs, clock: clock ?? attempt.clock };
}

function ignored(attempt, reason, event) {
  return { attempt: { ...attempt, ignored: [...attempt.ignored, { reason, ...event }] }, event: { type: 'ignored', reason } };
}

function eventTime(attempt, event) {
  if (typeof event === 'number') return { midi: event, time: null, clock: attempt.clock };
  return { midi: Number(event?.midi ?? event?.note), time: event?.time ?? event?.atMs ?? null, clock: event?.clock ?? attempt.clock, held: event?.held };
}

function timedTarget(attempt, event) {
  const offset = quarterToMs(attempt.expectation.tempoMap, event.onsetQuarter - attempt.originQuarter);
  return attempt.startedAt + attempt.leadInMs + offset;
}

function pendingNotes(attempt) {
  const result = [];
  for (const event of attempt.expectation.events) for (const note of event.notes) if (!attempt.hits[note.id] && !attempt.misses.includes(note.id)) result.push({ event, note });
  return result;
}

function completeIfDone(attempt, events) {
  if (pendingNotes(attempt).length) return { attempt, events };
  const completed = { ...attempt, status: 'completed' };
  return { attempt: completed, events: [...events, { type: 'attempt_complete' }] };
}

export function observeAssessment(attempt, midiOrHeldEvent) {
  if (attempt.status === 'prepared') return ignored(attempt, 'before_start', {});
  if (TERMINAL.has(attempt.status)) return ignored(attempt, 'terminated', {});
  if (attempt.status !== 'running') return ignored(attempt, 'not_running', {});
  const input = eventTime(attempt, midiOrHeldEvent);
  if (attempt.clock != null && input.clock !== attempt.clock) return ignored(attempt, 'wrong_clock', input);
  if (!Number.isFinite(input.midi) && !input.held) return ignored(attempt, 'invalid_input', input);
  if (attempt.matcher === 'timed' && !Number.isFinite(input.time)) return ignored(attempt, 'missing_time', input);
  if (Number.isFinite(input.time) && input.time < attempt.startedAt) return ignored(attempt, 'before_start', input);

  if (attempt.matcher === 'timed') {
    let best = null;
    for (const candidate of pendingNotes(attempt)) {
      if (candidate.note.midi !== input.midi) continue;
      const targetTime = timedTarget(attempt, candidate.event);
      const drift = input.time - targetTime;
      if (Math.abs(drift) <= attempt.policy.matchWindowMs && (!best || Math.abs(drift) < Math.abs(best.drift))) best = { ...candidate, targetTime, drift };
    }
    if (!best) {
      const nearest = pendingNotes(attempt).map((candidate) => ({
        ...candidate,
        distance: Math.abs(input.time - timedTarget(attempt, candidate.event)),
      })).sort((a, b) => a.distance - b.distance)[0];
      return {
        attempt: { ...attempt, musicalInput: true, wrong: [...attempt.wrong, { midi: input.midi, time: input.time, spanId: nearest?.event.spanId ?? null, eventId: nearest?.event.id ?? null }] },
        event: { type: 'wrong', midi: input.midi, eventId: nearest?.event.id ?? null },
      };
    }
    const samePitch = pendingNotes(attempt).filter(({ event, note }) => event.id === best.event.id && note.midi === input.midi);
    const hits = { ...attempt.hits };
    for (const { note } of samePitch) hits[note.id] = { time: input.time, driftMs: best.drift };
    const next = { ...attempt, musicalInput: true, hits, responses: [...attempt.responses, Math.max(0, input.time - best.targetTime)] };
    const onsetComplete = best.event.notes.every((note) => hits[note.id]);
    const completed = completeIfDone(next, [{ type: onsetComplete ? 'onset_complete' : 'hit', eventId: best.event.id, noteIds: samePitch.map(({ note }) => note.id), driftMs: best.drift }]);
    return { attempt: completed.attempt, event: completed.events[0], events: completed.events };
  }

  const index = skipEmpty(attempt.expectation.events, attempt.cursor);
  const current = attempt.expectation.events[index];
  if (!current) {
    const completed = completeIfDone(attempt, []);
    return { attempt: completed.attempt, event: completed.events.at(-1) || { type: 'ignored', reason: 'complete' } };
  }
  const heldPitches = input.held ? new Set(input.held instanceof Map ? input.held.keys() : input.held) : null;
  if (attempt.matcher === 'held' && heldPitches) {
    if (heldPitches.size === 0) {
      return { attempt: { ...attempt, heldWrongLatched: false }, event: { type: 'ignored', reason: 'held_released' } };
    }
    const expectedPitches = new Set(current.notes.map((note) => note.midi));
    const containsExpected = [...expectedPitches].every((midi) => heldPitches.has(midi));
    const exact = containsExpected && (attempt.policy.allowExtras || heldPitches.size === expectedPitches.size);
    if (!exact) {
      const onlyExpected = [...heldPitches].every((midi) => expectedPitches.has(midi));
      if (onlyExpected && heldPitches.size < expectedPitches.size) {
        return {
          attempt: { ...attempt, musicalInput: true, heldWrongLatched: false },
          event: { type: 'partial', eventId: current.id, held: [...heldPitches] },
        };
      }
      if (attempt.heldWrongLatched) return { attempt, event: { type: 'ignored', reason: 'held_wrong_latched' } };
      const wrongMidi = [...heldPitches].find((midi) => !expectedPitches.has(midi)) ?? [...heldPitches][0];
      return {
        attempt: { ...attempt, musicalInput: true, heldWrongLatched: true, wrong: [...attempt.wrong, { midi: wrongMidi, time: input.time, spanId: current.spanId, eventId: current.id }] },
        event: { type: 'wrong', eventId: current.id, midi: wrongMidi },
      };
    }
  }
  const matches = current.notes.filter((note) => !attempt.hits[note.id] && (heldPitches ? heldPitches.has(note.midi) : note.midi === input.midi));
  if (matches.length) {
    const hits = { ...attempt.hits };
    for (const note of matches) hits[note.id] = { time: input.time };
    const onsetComplete = current.notes.every((note) => hits[note.id]);
    const cursor = onsetComplete ? skipEmpty(attempt.expectation.events, index + 1) : index;
    const response = Number.isFinite(input.time) ? Math.max(0, input.time - (attempt.lastOnsetAt ?? attempt.startedAt)) : null;
    const next = { ...attempt, musicalInput: true, heldWrongLatched: false, hits, cursor, lastOnsetAt: onsetComplete && Number.isFinite(input.time) ? input.time : attempt.lastOnsetAt, responses: response == null ? attempt.responses : [...attempt.responses, response] };
    const events = [{ type: onsetComplete ? 'onset_complete' : 'hit', eventId: current.id, noteIds: matches.map((note) => note.id) }];
    if (onsetComplete && current.spanId !== attempt.expectation.events[cursor]?.spanId) events.push({ type: 'span_complete', spanId: current.spanId });
    const completed = completeIfDone(next, events);
    return { attempt: completed.attempt, event: completed.events[0], events: completed.events };
  }
  const pitches = current.notes.map((note) => note.midi);
  const plausible = heldPitches ? heldPitches.size > 0 : pitches.some((midi) => Math.abs(midi - input.midi) <= attempt.policy.wrongWindow);
  return plausible
    ? { attempt: { ...attempt, musicalInput: true, wrong: [...attempt.wrong, { midi: input.midi, time: input.time, spanId: current.spanId, eventId: current.id }] }, event: { type: 'wrong', eventId: current.id, midi: input.midi } }
    : ignored(attempt, 'implausible_pitch', input);
}

export function advanceAssessmentAttempt(attempt, time) {
  if (attempt.status !== 'running' || attempt.matcher !== 'timed') return { attempt, events: [] };
  const misses = [...attempt.misses];
  const events = [];
  for (const { event, note } of pendingNotes(attempt)) {
    if (time > timedTarget(attempt, event) + attempt.policy.missWindowMs) {
      misses.push(note.id);
      events.push({ type: 'miss', eventId: event.id, noteId: note.id });
    }
  }
  return completeIfDone({ ...attempt, misses }, events);
}

export function closeAssessmentAttemptSpan(attempt, spanId, time) {
  if (attempt.result || ['aborted', 'timeout', 'error'].includes(attempt.status)) return { attempt, events: [] };
  const misses = [...attempt.misses];
  const events = [];
  for (const { event, note } of pendingNotes(attempt)) if (event.spanId === spanId) { misses.push(note.id); events.push({ type: 'miss', eventId: event.id, noteId: note.id, time }); }
  const next = { ...attempt, misses, closedSpans: [...new Set([...attempt.closedSpans, spanId])] };
  const spanResult = finalizeAssessmentAttempt(next, { status: 'completed' }).result?.spans?.[spanId] ?? null;
  return { attempt: next, events: [...events, { type: 'span_complete', spanId, result: spanResult }] };
}

function attribution(attempt, wrong) {
  const current = attempt.expectation.events.find((event) => event.id === wrong.eventId)
    || attempt.expectation.events.find((event) => event.spanId === wrong.spanId)
    || attempt.expectation.events[attempt.cursor];
  if (!current?.notes.length || !Number.isFinite(wrong.midi)) return { ambiguous: true };
  let distance = Infinity;
  let nearest = [];
  for (const note of current.notes) {
    const d = Math.abs(note.midi - wrong.midi);
    if (d < distance) { distance = d; nearest = [note.part]; } else if (d === distance && !nearest.includes(note.part)) nearest.push(note.part);
  }
  if (nearest.length === 1) return { part: nearest[0] };
  return { ambiguous: true };
}

function resultSlice(attempt, notes, wrongCount) {
  const matched = notes.filter((note) => attempt.hits[note.id]).length;
  const expected = notes.length;
  const drifts = notes.map((note) => attempt.hits[note.id]?.driftMs).filter(Number.isFinite);
  const placement = drifts.length ? drifts.reduce((sum, drift) => sum + unit(1 - Math.max(0, Math.abs(drift) - attempt.policy.timingToleranceMs) / attempt.policy.timingWindowMs), 0) / drifts.length : 0;
  return {
    criteria: { completeness: expected ? matched / expected : 1, cleanliness: matched + wrongCount ? matched / (matched + wrongCount) : (expected ? 0 : 1), ...(attempt.matcher === 'timed' ? { placement } : {}) },
    diagnostics: { expected_notes: expected, matched_notes: matched, wrong_notes: wrongCount, missed_notes: expected - matched },
  };
}

export function finalizeAssessmentAttempt(attempt, { status = 'completed' } = {}) {
  if (attempt.result) return attempt;
  if (!TERMINAL.has(status)) throw new Error(`Unsupported terminal status: ${status}`);
  if (status !== 'completed') return { ...attempt, status, result: { status, diagnostics: { expected_notes: pendingNotes(attempt).length + Object.keys(attempt.hits).length, matched_notes: Object.keys(attempt.hits).length, wrong_notes: attempt.wrong.length, missed_notes: attempt.misses.length } } };
  const allNotes = attempt.expectation.events.flatMap((event) => event.notes.map((note) => ({ ...note, spanId: event.spanId })));
  const parts = [...new Set(allNotes.map((note) => note.part))];
  const requested = attempt.grading.part_weights || attempt.requirement?.rubric?.part_weights || {};
  const raw = Object.fromEntries(parts.map((part) => [part, Number.isFinite(requested[part]) ? Math.max(0, requested[part]) : 1]));
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  const weights = Object.fromEntries(parts.map((part) => [part, raw[part] / total]));
  const wrongByPart = Object.fromEntries(parts.map((part) => [part, 0]));
  const aggregateWrongByPart = { ...wrongByPart };
  for (const wrong of attempt.wrong) {
    const attributed = attribution(attempt, wrong);
    if (attributed.part) {
      wrongByPart[attributed.part] += 1;
      aggregateWrongByPart[attributed.part] += 1;
    } else {
      for (const part of parts) aggregateWrongByPart[part] += weights[part];
    }
  }
  const partResults = Object.fromEntries(parts.map((part) => [part, resultSlice(attempt, allNotes.filter((note) => note.part === part), wrongByPart[part])]));
  const criteriaNames = attempt.matcher === 'timed' ? ['completeness', 'cleanliness', 'placement'] : ['completeness', 'cleanliness'];
  const criteria = Object.fromEntries(criteriaNames.map((name) => [name, parts.reduce((sum, part) => sum + partResults[part].criteria[name] * weights[part], 0)]));
  criteria.cleanliness = parts.reduce((sum, part) => {
    const matched = partResults[part].diagnostics.matched_notes;
    const wrong = aggregateWrongByPart[part];
    return sum + (matched + wrong ? matched / (matched + wrong) : 0) * weights[part];
  }, 0);
  const spans = {};
  for (const spanId of new Set(allNotes.map((note) => note.spanId).filter((id) => id != null))) {
    const spanNotes = allNotes.filter((note) => note.spanId === spanId);
    const spanPartNames = parts.filter((part) => spanNotes.some((note) => note.part === part));
    const spanWeightTotal = spanPartNames.reduce((sum, part) => sum + weights[part], 0) || 1;
    const spanWeights = Object.fromEntries(spanPartNames.map((part) => [part, weights[part] / spanWeightTotal]));
    const spanWrongs = attempt.wrong.filter((wrong) => wrong.spanId === spanId);
    const spanWrongByPart = Object.fromEntries(spanPartNames.map((part) => [part, 0]));
    const spanAggregateWrong = { ...spanWrongByPart };
    for (const wrong of spanWrongs) {
      const attributed = attribution(attempt, wrong);
      if (attributed.part && attributed.part in spanWrongByPart) {
        spanWrongByPart[attributed.part] += 1;
        spanAggregateWrong[attributed.part] += 1;
      } else {
        for (const part of spanPartNames) spanAggregateWrong[part] += spanWeights[part];
      }
    }
    const spanParts = Object.fromEntries(spanPartNames.map((part) => [
      part,
      resultSlice(attempt, spanNotes.filter((note) => note.part === part), spanWrongByPart[part]),
    ]));
    const spanCriteria = Object.fromEntries(criteriaNames.map((name) => [
      name,
      spanPartNames.reduce((sum, part) => sum + spanParts[part].criteria[name] * spanWeights[part], 0),
    ]));
    spanCriteria.cleanliness = spanPartNames.reduce((sum, part) => {
      const matched = spanParts[part].diagnostics.matched_notes;
      const wrong = spanAggregateWrong[part];
      return sum + (matched + wrong ? matched / (matched + wrong) : 0) * spanWeights[part];
    }, 0);
    spans[spanId] = {
      criteria: spanCriteria,
      parts: spanParts,
      diagnostics: resultSlice(attempt, spanNotes, spanWrongs.length).diagnostics,
    };
  }
  const rubricWeights = { completeness: 1, cleanliness: 1, ...(attempt.matcher === 'timed' ? { placement: 1 } : {}), ...(attempt.grading.weights || {}) };
  const usedWeight = criteriaNames.reduce((sum, name) => sum + Math.max(0, rubricWeights[name] || 0), 0) || 1;
  const score = criteriaNames.reduce((sum, name) => sum + criteria[name] * Math.max(0, rubricWeights[name] || 0), 0) / usedWeight;
  const thresholds = attempt.requirement?.rubric?.criteria || {};
  const failedCriteria = Object.entries(thresholds).filter(([name, value]) => !Number.isFinite(criteria[name]) || criteria[name] < value).map(([name]) => name);
  const targetBpm = Number(attempt.requirement?.gates?.pace?.target_bpm);
  const failedGates = Number.isFinite(targetBpm) && (attempt.expectation.tempoMap[0]?.bpm || 0) < targetBpm ? ['pace'] : [];
  const responseMedian = median(attempt.responses);
  const result = {
    status: 'completed', score, criteria, parts: partResults, spans,
    diagnostics: { expected_notes: allNotes.length, matched_notes: Object.keys(attempt.hits).length, wrong_notes: attempt.wrong.length, missed_notes: allNotes.length - Object.keys(attempt.hits).length, ...(Number.isFinite(responseMedian) ? { response_median_ms: responseMedian } : {}) },
    rubric: { id: attempt.requirement?.rubric?.id || 'piano-assessment-v2', version: String(attempt.requirement?.rubric?.version || '2'), weights: rubricWeights, part_weights: weights },
    verdict: { score, passed: failedCriteria.length === 0 && failedGates.length === 0, failed_criteria: failedCriteria, failed_gates: failedGates },
  };
  return { ...attempt, status: 'completed', result };
}

export function assessmentAttemptProgress(attempt) {
  const expected = attempt.expectation.events.reduce((sum, event) => sum + event.notes.length, 0);
  const matched = Object.keys(attempt.hits).length;
  const timedIndex = attempt.matcher === 'timed'
    ? attempt.expectation.events.findIndex((event) => event.notes.some((note) => !attempt.hits[note.id] && !attempt.misses.includes(note.id)))
    : attempt.cursor;
  return { eventIndex: timedIndex < 0 ? attempt.expectation.events.length : timedIndex, expectedNotes: expected, matchedNotes: matched, ratio: expected ? matched / expected : 1, complete: attempt.status === 'completed' };
}

export { VALUES as EXERCISE_VALUE_QUARTERS };
