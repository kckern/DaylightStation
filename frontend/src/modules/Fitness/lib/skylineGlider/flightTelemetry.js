function activeTerrainId(course, courseTime) {
  return (course?.segments || []).find((segment) => segment.safeBand
    && courseTime >= segment.start_s
    && courseTime <= (segment.end_s ?? segment.start_s))?.id || null;
}

function visibleSegmentIds(course, courseTime) {
  const previewEnd = courseTime + 11;
  return (course?.segments || [])
    .filter((segment) => (segment.end_s ?? segment.start_s) >= courseTime - 3
      && segment.start_s <= previewEnd)
    .map((segment) => segment.id);
}

function buildSample(next, input, course, courseSecond) {
  return {
    courseSecond,
    courseTime: next.courseTime,
    rawRpm: Math.max(0, Number(input?.rpm) || 0),
    filteredRpm: next.filteredRpm,
    calibration: { ...next.calibration },
    altitude: next.altitude,
    targetAltitude: next.targetAltitude,
    verticalRate: next.verticalRate,
    lives: next.lives,
    phase: next.phase,
    visibleSegmentIds: visibleSegmentIds(course, next.courseTime),
    sensor: {
      connected: !!input?.connected,
      stalled: !!input?.transportStalled,
      paused: !!next.pausedForSensor,
    },
  };
}

export function collectFlightTelemetry({
  previous, next, input, previousInput, lastSampleSecond = -1, course,
}) {
  const events = [];
  const connected = !!input?.connected && !input?.transportStalled;
  const wasConnected = !!previousInput?.connected && !previousInput?.transportStalled;
  if (previousInput && connected !== wasConnected) {
    events.push({
      type: connected ? 'input.connected' : 'input.disconnected',
      data: {
        connected: !!input?.connected,
        stalled: !!input?.transportStalled,
      },
    });
  }
  if (!!next.pausedForSensor !== !!previous.pausedForSensor) {
    const paused = !!next.pausedForSensor;
    events.push({
      type: paused ? 'sensor.paused' : 'sensor.resumed',
      data: {},
    });
  }

  const coastSeconds = Number(course?.motion?.coast_s) || 0;
  const wasCoasting = previous.zeroElapsed > coastSeconds;
  const isCoasting = next.zeroElapsed > coastSeconds;
  if (isCoasting !== wasCoasting) {
    events.push({
      type: isCoasting ? 'coast.started' : 'coast.ended',
      data: {},
    });
  }

  if (next.collisions > previous.collisions) {
    events.push({
      type: 'collision',
      data: {
        count: next.collisions,
        lives: next.lives,
        segmentId: activeTerrainId(course, next.courseTime),
      },
    });
  }

  const priorCollectibles = new Set(previous.collectedIds || []);
  for (const collectibleId of next.collectedIds || []) {
    if (!priorCollectibles.has(collectibleId)) {
      events.push({ type: 'collectible', data: { collectibleId } });
    }
  }

  if (next.checkpoint?.id !== previous.checkpoint?.id) {
    events.push({
      type: 'checkpoint',
      data: {
        checkpointId: next.checkpoint.id,
        checkpointTime: next.checkpoint.time,
      },
    });
  }
  if (next.phase === 'crashed' && previous.phase !== 'crashed') {
    events.push({ type: 'crashed', data: {} });
  }
  if (next.restarts > previous.restarts) {
    events.push({
      type: 'restarted',
      data: {
        restartCount: next.restarts,
        checkpointId: next.checkpoint.id,
      },
    });
  }
  if (next.phase === 'completed' && previous.phase !== 'completed') {
    events.push({ type: 'completed', data: {} });
  }

  const courseSecond = Math.floor(next.courseTime);
  const rewound = next.courseTime < previous.courseTime || next.restarts > previous.restarts;
  const shouldSample = rewound || courseSecond > lastSampleSecond;
  return {
    sample: shouldSample ? buildSample(next, input, course, courseSecond) : null,
    events,
    nextSampleSecond: shouldSample ? courseSecond : lastSampleSecond,
  };
}
