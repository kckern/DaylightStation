import { createHash } from 'node:crypto';

export const PRODUCER_SCHEMA_VERSION = 2;
export const PRODUCER_FAMILIES = Object.freeze(['loops', 'crate', 'songs']);
export const PRODUCER_ID_RE = /^[a-z0-9-]{1,64}$/;

const ROLES = new Set(['chords', 'melody', 'bass', 'idea', 'groove']);
const BPM_MIN = 40;
const BPM_MAX = 220;
const SHA256_RE = /^[a-f0-9]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => [key, stable(value[key])]),
  );
}

export function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

/** Identity/provenance and presentation fields do not change musical content. */
export function producerContent(family, record) {
  if (family === 'loops') {
    return {
      kind: record.kind ?? 'idea', notes: record.notes ?? [], ppq: record.ppq ?? 480,
      lengthBars: record.lengthBars ?? null, drumMode: !!record.drumMode,
      timeline: record.timeline ?? null,
    };
  }
  if (family === 'crate') {
    return {
      kind: record.kind ?? 'stack', layers: record.layers ?? [],
      lengthBars: record.lengthBars ?? null, meta: record.meta ?? null,
    };
  }
  return {
    sections: record.sections ?? [], arrangement: record.arrangement ?? [],
    carriedLayers: record.carriedLayers ?? {},
    meta: { ...(record.meta ?? {}), title: undefined },
  };
}

export function producerContentHash(family, record) {
  return sha256(producerContent(family, record));
}

function positiveInt(value, fallback = null) {
  return Number.isFinite(value) && Math.trunc(value) > 0 ? Math.trunc(value) : fallback;
}

function layerNaturalBars(layer) {
  const source = layer?.source;
  return positiveInt(source?.lengthBars)
    ?? positiveInt(source?.entry?.barSpan)
    ?? null;
}

export function inferCrateLengthBars(layers) {
  const lengths = (layers ?? []).map(layerNaturalBars).filter(Number.isFinite);
  return lengths.length ? Math.max(...lengths) : 4;
}

function titleLabel(family, record) {
  if (family === 'loops') {
    return ({ chords: 'Chords', melody: 'Melody', bass: 'Bass', groove: 'Drums', idea: 'Loop' })[record.kind] ?? 'Loop';
  }
  if (family === 'crate') return record.kind === 'section' ? 'Section' : 'Stack';
  return 'Song';
}

export function defaultProducerTitle(family, record, id = '') {
  const label = titleLabel(family, record);
  const timestamp = typeof record.created === 'string' ? record.created.slice(0, 16).replace('T', ' ') : '';
  return timestamp ? `${label} · ${timestamp}` : `${label} · ${id || 'untitled'}`;
}

/** Upgrade a record to the current stored shape without discarding unknown metadata. */
export function normalizeProducerRecord(family, input, { id = input?.id, now = new Date().toISOString() } = {}) {
  if (!PRODUCER_FAMILIES.includes(family)) throw new Error(`Unknown Producer family: ${family}`);
  const record = { ...(input && typeof input === 'object' ? input : {}) };
  if (id) record.id = id;
  record.schemaVersion = PRODUCER_SCHEMA_VERSION;
  record.created = typeof record.created === 'string' && record.created ? record.created : now;
  record.modified = typeof record.modified === 'string' && record.modified ? record.modified : record.created;
  record.revision = positiveInt(record.revision, 1);
  record.title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : defaultProducerTitle(family, record, id);
  if (family === 'crate') {
    record.lengthBars = positiveInt(record.lengthBars, inferCrateLengthBars(record.layers));
  }
  if (family === 'songs') {
    record.meta = { ...(record.meta ?? {}), title: record.title };
  }
  record.contentHash = producerContentHash(family, record);
  if (family === 'loops' && typeof record.sourceTakeId === 'string' && record.sourceTakeId) {
    record.dedupeKey = sha256({ author: record.author, sourceTakeId: record.sourceTakeId, contentHash: record.contentHash });
  } else if (family === 'crate') {
    record.dedupeKey = sha256({ author: record.author, family, contentHash: record.contentHash });
  }
  return record;
}

function validateLayer(layer, at, errors, { allowCarriedRef = false, hasLoop = null } = {}) {
  if (!layer || typeof layer !== 'object') { errors.push(`${at} must be an object`); return; }
  if (allowCarriedRef && typeof layer.carriedRef === 'string' && layer.carriedRef) return;
  if (typeof layer.id !== 'string' || !layer.id) errors.push(`${at}.id required`);
  if (!ROLES.has(layer.role)) errors.push(`${at}.role invalid`);
  if (!Number.isInteger(layer.channel) || layer.channel < 0 || layer.channel > 15) errors.push(`${at}.channel invalid`);
  else if (layer.role === 'groove' && layer.channel !== 9) errors.push(`${at}.channel must be 9 for groove`);
  else if (layer.role !== 'groove' && layer.channel === 9) errors.push(`${at}.channel 9 is reserved for groove`);
  if (!Number.isFinite(layer.gain) || layer.gain < 0 || layer.gain > 1) errors.push(`${at}.gain must be 0..1`);
  for (const field of ['muted', 'soloed', 'carried']) {
    if (typeof layer[field] !== 'boolean') errors.push(`${at}.${field} must be boolean`);
  }
  if (layer.role === 'groove') {
    if (layer.gmProgram != null) errors.push(`${at}.gmProgram must be null for groove`);
  } else if (!Number.isInteger(layer.gmProgram) || layer.gmProgram < 0 || layer.gmProgram > 127) {
    errors.push(`${at}.gmProgram must be 0..127`);
  }
  const source = layer.source;
  if (!source || typeof source !== 'object') { errors.push(`${at}.source required`); return; }
  if (source.kind === 'library') {
    if (!source.entry || typeof source.entry !== 'object') errors.push(`${at}.source.entry required`);
    else if (!(typeof source.entry.path === 'string' && source.entry.path) && !(typeof source.entry.slug === 'string' && source.entry.slug)) errors.push(`${at}.source.entry identity required`);
  } else if (source.kind === 'loop') {
    if (typeof source.loopId !== 'string' || !source.loopId) errors.push(`${at}.source.loopId required`);
    else if (!PRODUCER_ID_RE.test(source.loopId)) errors.push(`${at}.source.loopId invalid`);
    else if (hasLoop && !hasLoop(source.loopId)) errors.push(`${at}.source.loopId missing: ${source.loopId}`);
  } else if (source.kind === 'take') {
    errors.push(`${at}.source.take must be persisted as a loop reference`);
  } else {
    errors.push(`${at}.source.kind invalid`);
  }
}

function validateLayerChannels(layers, at, errors) {
  const ids = new Set();
  const pitchedChannels = new Map();
  (layers ?? []).forEach((layer, index) => {
    if (!layer || layer.carriedRef) return;
    if (ids.has(layer.id)) errors.push(`${at}[${index}].id duplicates ${layer.id}`);
    else ids.add(layer.id);
    if (layer.role === 'groove' || !Number.isInteger(layer.channel)) return;
    const prior = pitchedChannels.get(layer.channel);
    if (prior != null) errors.push(`${at}[${index}].channel duplicates ${at}[${prior}].channel ${layer.channel}`);
    else pitchedChannels.set(layer.channel, index);
  });
}

function validateNote(note, at, errors) {
  if (!note || typeof note !== 'object') { errors.push(`${at} must be an object`); return; }
  if (!Number.isInteger(note.ticks) || note.ticks < 0) errors.push(`${at}.ticks must be a non-negative integer`);
  if (!Number.isInteger(note.durationTicks) || note.durationTicks <= 0) errors.push(`${at}.durationTicks must be a positive integer`);
  if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) errors.push(`${at}.midi must be 0..127`);
  if (note.velocity != null && (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127)) {
    errors.push(`${at}.velocity must be 1..127`);
  }
}

/** Returns every schema/referential-integrity error; an empty array is valid. */
export function validateProducerRecord(family, record, { hasLoop = null } = {}) {
  const errors = [];
  if (!record || typeof record !== 'object') return ['record must be an object'];
  if (!PRODUCER_ID_RE.test(record.id ?? '')) errors.push('id invalid');
  if (record.schemaVersion !== PRODUCER_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PRODUCER_SCHEMA_VERSION}`);
  if (typeof record.author !== 'string' || !record.author.trim()) errors.push('author required');
  if (typeof record.title !== 'string' || !record.title.trim()) errors.push('title required');
  if (!positiveInt(record.revision)) errors.push('revision must be a positive integer');
  if (!SHA256_RE.test(record.contentHash ?? '')) errors.push('contentHash must be SHA-256');
  else if (record.contentHash !== producerContentHash(family, record)) errors.push('contentHash does not match musical content');
  if (typeof record.created !== 'string' || !Number.isFinite(Date.parse(record.created))) errors.push('created must be an ISO timestamp');
  if (typeof record.modified !== 'string' || !Number.isFinite(Date.parse(record.modified))) errors.push('modified must be an ISO timestamp');

  if (family === 'loops') {
    if (!Array.isArray(record.notes) || record.notes.length === 0) errors.push('notes must be a non-empty array');
    else record.notes.forEach((note, i) => validateNote(note, `notes[${i}]`, errors));
    if (!positiveInt(record.ppq)) errors.push('ppq must be a positive integer');
    if (!positiveInt(record.lengthBars)) errors.push('lengthBars must be a positive integer');
    if (!ROLES.has(record.kind)) errors.push('kind invalid');
  } else if (family === 'crate') {
    if (!Array.isArray(record.layers) || record.layers.length === 0) errors.push('layers must be a non-empty array');
    else {
      record.layers.forEach((layer, i) => validateLayer(layer, `layers[${i}]`, errors, { hasLoop }));
      validateLayerChannels(record.layers, 'layers', errors);
    }
    if (!positiveInt(record.lengthBars)) errors.push('lengthBars must be a positive integer');
    if (!['stack', 'section'].includes(record.kind)) errors.push('kind must be stack or section');
  } else if (family === 'songs') {
    if (!Array.isArray(record.sections) || record.sections.length === 0) errors.push('sections must be a non-empty array');
    const sectionIds = new Set();
    (record.sections ?? []).forEach((section, si) => {
      if (typeof section?.id !== 'string' || !section.id) errors.push(`sections[${si}].id required`);
      else if (sectionIds.has(section.id)) errors.push(`duplicate section id: ${section.id}`);
      else sectionIds.add(section.id);
      if (!positiveInt(section?.lengthBars)) errors.push(`sections[${si}].lengthBars invalid`);
      if (typeof section?.name !== 'string' || !section.name.trim()) errors.push(`sections[${si}].name required`);
      if (!Array.isArray(section?.stack)) errors.push(`sections[${si}].stack must be an array`);
      else {
        section.stack.forEach((layer, li) => validateLayer(layer, `sections[${si}].stack[${li}]`, errors, { allowCarriedRef: true, hasLoop }));
        const resolved = section.stack.map((layer) => (
          layer?.carriedRef ? record.carriedLayers?.[layer.carriedRef] : layer
        )).filter(Boolean);
        validateLayerChannels(resolved, `sections[${si}].stack`, errors);
      }
    });
    if (!Array.isArray(record.arrangement) || record.arrangement.length === 0) errors.push('arrangement must be a non-empty array');
    else record.arrangement.forEach((entry, i) => {
      if (!sectionIds.has(entry?.sectionId)) errors.push(`arrangement[${i}] references missing section`);
      if (!positiveInt(entry?.repeats)) errors.push(`arrangement[${i}].repeats invalid`);
    });
    if (!record.carriedLayers || typeof record.carriedLayers !== 'object' || Array.isArray(record.carriedLayers)) {
      errors.push('carriedLayers must be an object');
    }
    for (const [id, layer] of Object.entries(record.carriedLayers ?? {})) {
      validateLayer(layer, `carriedLayers.${id}`, errors, { hasLoop });
    }
    (record.sections ?? []).flatMap((section) => section.stack ?? []).forEach((layer) => {
      if (layer?.carriedRef && !record.carriedLayers?.[layer.carriedRef]) errors.push(`missing carried layer: ${layer.carriedRef}`);
    });
    if (
      !record.meta
      || !Number.isFinite(record.meta.bpm)
      || record.meta.bpm < BPM_MIN
      || record.meta.bpm > BPM_MAX
      || !Number.isInteger(record.meta.keyShift)
    ) errors.push(`meta.bpm (${BPM_MIN}..${BPM_MAX}) and integer meta.keyShift required`);
  }
  return errors;
}
