/** HTTP-only translators for the injected SchoolCalc application container. */

export function schoolCalcEnrollHandler({ container }) {
  return async (req, res) => {
    const result = await container.enrollDevice.execute(req.body ?? {});
    res.status(201).set('Cache-Control', 'no-store').json({
      device: result.device,
      identity: encodedRecord(result.identityRecord),
      learnerRoster: serializeLearnerRoster(result.learnerRoster),
    });
  };
}

export function schoolCalcLearnerRosterHandler({ container }) {
  return async (req, res) => {
    const roster = await container.getLearnerRoster.execute({ deviceId: req.params.deviceId });
    res.set('Cache-Control', 'private, no-cache').json(serializeLearnerRoster(roster));
  };
}

export function schoolCalcProgressHandler({ container }) {
  return async (req, res) => {
    const progress = await container.getProgressProjection.execute({ deviceId: req.params.deviceId });
    const etag = quoteEtag(progress.generation);
    res.set({
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      'Content-Type': 'application/vnd.daylight.schoolcalc.progress',
      'X-SchoolCalc-Progress-Generation': progress.generation,
    });
    if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
    return res.send(Buffer.from(progress.record));
  };
}

export function schoolCalcFollowUpResolveHandler({ container }) {
  return async (req, res) => {
    if (!container.resolveFollowUp || typeof container.resolveFollowUp.execute !== 'function') {
      const error = new Error('SchoolCalc follow-up resolution is unavailable');
      error.name = 'InfrastructureError';
      throw error;
    }
    const outcome = await container.resolveFollowUp.execute({
      deviceId: req.params.deviceId,
      learnerKey: req.body?.learnerKey,
      actionKey: req.params.actionKey,
    });
    res.set('Cache-Control', 'no-store').json(outcome);
  };
}

export function schoolCalcIdentifyHandler({ container }) {
  return async (req, res) => {
    const identity = await container.identifyDevice.execute({
      record: requiredBinaryBody(req.body, 'device identity'),
    });
    res.set('Cache-Control', 'no-store').json(identity);
  };
}

export function schoolCalcObserveHandler({ container, relayIdFromRequest }) {
  return async (req, res) => {
    const relayId = requiredRelayId(req, relayIdFromRequest);
    const device = await container.observeDevice.execute({
      deviceId: req.params.deviceId,
      rawInfo: requiredBinaryBody(req.body, 'device info'),
      relayId,
    });
    res.json(device);
  };
}

export function schoolCalcCatalogHandler({ container }) {
  return async (req, res) => {
    const catalog = await container.getCatalog.execute({ deviceId: req.params.deviceId });
    const etag = quoteEtag(catalog.generation);
    res.set({
      ETag: etag,
      'Cache-Control': 'private, no-cache',
      'Content-Type': 'application/vnd.daylight.schoolcalc.catalog',
      'X-SchoolCalc-Catalog-Generation': catalog.generation,
    });
    if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
    return res.send(Buffer.from(catalog.record));
  };
}

export function schoolCalcDeliveryRequestsHandler({ container }) {
  return async (req, res) => {
    const result = await container.requestDelivery.execute({
      deviceId: req.params.deviceId,
      record: requiredBinaryBody(req.body, 'delivery request'),
    });
    res.json(result);
  };
}

export function schoolCalcArtifactHandler({ container }) {
  return async (req, res) => {
    const artifact = await container.getArtifact.execute({ artifactId: req.params.artifactId });
    res.set({
      'Content-Type': artifact.mediaType,
      'Content-Length': String(artifact.byteLength),
      ETag: quoteEtag(artifact.byteDigest),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-SchoolCalc-Artifact-Id': artifact.artifactId,
      'X-SchoolCalc-Variable-Name': artifact.variableName,
      'X-SchoolCalc-Byte-Digest': artifact.byteDigest,
      'X-SchoolCalc-Byte-Length': String(artifact.byteLength),
    });
    res.send(Buffer.from(artifact.bytes));
  };
}

export function schoolCalcResultImportHandler({ container }) {
  return async (req, res) => {
    const record = typeof req.body === 'string'
      ? req.body.trim()
      : requiredBinaryBody(req.body, 'result');
    if (typeof record === 'string' && !record) throw requestError('SchoolCalc result body is empty');
    const requestedTransport = req.get('X-SchoolCalc-Transport');
    const transport = requestedTransport ?? (typeof record === 'string' ? 'qr' : 'relay');
    const result = await container.importResult.execute({ record, transport });
    res.status(result.status === 'conflict' ? 409 : 200).json(result);
  };
}

export function schoolCalcSyncHandler({ container, relayIdFromRequest }) {
  return async (req, res) => {
    const relayId = requiredRelayId(req, relayIdFromRequest);
    const body = req.body ?? {};
    const outcome = await container.syncDevice.execute({
      deviceId: req.params.deviceId,
      relayId,
      rawInfo: optionalEncodedRecord(body.rawInfo, 'rawInfo'),
      rawState: optionalEncodedRecord(body.installedState, 'installedState'),
      resultQueue: optionalEncodedRecord(body.resultQueue, 'resultQueue'),
      requestRecord: optionalEncodedRecord(body.requestRecord, 'requestRecord'),
      interactionRecord: optionalEncodedRecord(body.interactionRecord, 'interactionRecord'),
      catalogGeneration: body.catalogGeneration ?? null,
    });
    res.json(serializeSyncOutcome(outcome));
  };
}

export function schoolCalcRemediationListHandler({ container }) {
  return async (req, res) => {
    const tutor = requiredRemediationTutor(container);
    const available = await tutor.listAvailable({
      surface: 'schoolcalc', endpointId: req.params.deviceId,
    });
    const limit = positiveQueryInteger(req.query.limit, 'limit', { defaultValue: 20, maximum: 50 });
    const sessions = available.slice(0, limit);
    res.set('Cache-Control', 'no-store').json({
      sessions,
      hasMore: available.length > sessions.length,
    });
  };
}

export function schoolCalcRemediationSessionHandler({ container }) {
  return async (req, res) => {
    const tutor = requiredRemediationTutor(container);
    const session = await tutor.get({
      sessionId: req.params.sessionId,
      access: { surface: 'schoolcalc', endpointId: req.params.deviceId },
      afterServerSequence: nonNegativeQueryInteger(req.query.after, 'after'),
      maxTurns: positiveQueryInteger(req.query.limit, 'limit', { defaultValue: 20, maximum: 50 }),
    });
    res.set('Cache-Control', 'no-store').json({ session });
  };
}

export function schoolCalcRemediationActionHandler({ container }) {
  return async (req, res) => {
    const tutor = requiredRemediationTutor(container);
    try {
      const outcome = await tutor.act({
        sessionId: req.params.sessionId,
        access: { surface: 'schoolcalc', endpointId: req.params.deviceId },
        clientSequence: req.body?.clientSequence,
        lastServerSequence: req.body?.lastServerSequence,
        action: req.body?.action,
        turnId: req.body?.turnId ?? null,
        choiceId: req.body?.choiceId ?? null,
      });
      res.set('Cache-Control', 'no-store')
        .status(outcome.status === 'processing' ? 202 : 200)
        .json(outcome);
    } catch (error) {
      if (['REMEDIATION_ACTION_CONFLICT', 'REMEDIATION_ACTION_OUT_OF_ORDER'].includes(error?.code)) {
        return res.status(409).set('Cache-Control', 'no-store').json({
          error: error.message, code: error.code,
        });
      }
      throw error;
    }
  };
}

function serializeSyncOutcome(outcome) {
  if (!outcome?.plan) return outcome;
  const { acknowledgementRecord, manifestRecord, ...plan } = outcome.plan;
  return {
    ...outcome,
    profiles: outcome.profiles ? serializeLearnerRoster(outcome.profiles) : null,
    progress: outcome.progress ? serializeProgressProjection(outcome.progress) : null,
    interaction: outcome.interaction ? serializeInteraction(outcome.interaction) : null,
    plan: {
      ...plan,
      acknowledgement: encodedRecord(acknowledgementRecord),
      manifest: encodedRecord(manifestRecord),
    },
  };
}

function serializeInteraction(interaction) {
  const { record, ...view } = interaction;
  return { ...view, record: encodedRecord(record) };
}

function serializeProgressProjection(progress) {
  if (!progress) return null;
  const { record, ...view } = progress;
  return { ...view, record: encodedRecord(record) };
}

function serializeLearnerRoster(roster) {
  if (!roster) return null;
  const { record, ...view } = roster;
  return { ...view, record: encodedRecord(record) };
}

function encodedRecord(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error('SchoolCalc application returned a non-binary record');
  }
  return { encoding: 'base64url', data: Buffer.from(value).toString('base64url') };
}

function optionalEncodedRecord(value, field) {
  if (value === undefined || value === null) return null;
  if (!value || value.encoding !== 'base64url' || typeof value.data !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(value.data)) {
    throw requestError(`${field} must be a non-empty base64url record`);
  }
  const bytes = Buffer.from(value.data, 'base64url');
  if (bytes.length === 0 || bytes.toString('base64url') !== value.data.replace(/=+$/, '')) {
    throw requestError(`${field} contains invalid base64url data`);
  }
  return bytes;
}

function requiredBinaryBody(value, label) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw requestError(`SchoolCalc ${label} body must be binary`);
  return value;
}

function requiredRelayId(req, relayIdFromRequest) {
  const relayId = relayIdFromRequest(req);
  if (typeof relayId !== 'string' || !relayId) {
    const error = new Error('Authenticated SchoolCalc ingress has no relay identity');
    error.name = 'AuthorizationError';
    throw error;
  }
  return relayId;
}

function requiredRemediationTutor(container) {
  if (!container?.remediationTutor) {
    const error = new Error('Adaptive remediation is unavailable');
    error.name = 'InfrastructureError';
    throw error;
  }
  return container.remediationTutor;
}

function nonNegativeQueryInteger(value, field) {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw requestError(`${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw requestError(`${field} is too large`);
  return parsed;
}

function positiveQueryInteger(value, field, { defaultValue, maximum }) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw requestError(`${field} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw requestError(`${field} must not exceed ${maximum}`);
  }
  return parsed;
}

function requestError(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  return error;
}

function quoteEtag(value) { return `"${String(value).replaceAll('"', '')}"`; }

function etagMatches(header, expected) {
  return typeof header === 'string' && header.split(',').map((value) => value.trim()).includes(expected);
}
