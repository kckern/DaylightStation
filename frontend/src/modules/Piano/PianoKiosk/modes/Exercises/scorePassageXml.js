const ATTRIBUTE_ORDER = [
  'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments',
  'clef', 'staff-details', 'transpose', 'measure-style',
];

const empty = (error) => ({ musicXml: null, originalMeasureIndices: [], inheritedTempoMap: [], error });
const directChildren = (element, name) => [...(element?.children ?? [])].filter((child) => child.localName === name);
const attributeKey = (element) => `${element.localName}:${element.getAttribute('number') ?? ''}`;

function effectiveAttributes(document, measures, start) {
  const state = new Map();
  for (const measure of measures.slice(0, start)) {
    for (const attributes of directChildren(measure, 'attributes')) {
      for (const child of attributes.children) state.set(attributeKey(child), child.cloneNode(true));
    }
  }
  if (!state.size) return null;
  const attributes = document.createElement('attributes');
  for (const name of ATTRIBUTE_ORDER) {
    for (const child of state.values()) if (child.localName === name) attributes.appendChild(child);
  }
  return attributes;
}

function effectiveTempo(measures, start) {
  let bpm = null;
  for (const measure of measures.slice(0, start)) {
    for (const sound of measure.getElementsByTagName('sound')) {
      const candidate = Number(sound.getAttribute('tempo'));
      if (Number.isFinite(candidate) && candidate > 0) bpm = candidate;
    }
  }
  return bpm;
}

function tempoDirection(document, bpm) {
  if (!bpm) return null;
  const direction = document.createElement('direction');
  const directionType = document.createElement('direction-type');
  const metronome = document.createElement('metronome');
  const beatUnit = document.createElement('beat-unit');
  const perMinute = document.createElement('per-minute');
  beatUnit.textContent = 'quarter';
  perMinute.textContent = String(bpm);
  metronome.append(beatUnit, perMinute);
  directionType.appendChild(metronome);
  const sound = document.createElement('sound');
  sound.setAttribute('tempo', String(bpm));
  direction.append(directionType, sound);
  return direction;
}

function removeForcedBreaks(measure) {
  for (const print of measure.getElementsByTagName('print')) {
    print.removeAttribute('new-system');
    print.removeAttribute('new-page');
  }
}

/** Build a self-contained MusicXML document for one inclusive canonical measure range. */
export function excerptMusicXml(musicXml, range) {
  if (typeof musicXml !== 'string' || !musicXml.trim()) return empty('invalid-xml');
  const document = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) return empty('invalid-xml');

  const parts = [...document.getElementsByTagName('part')];
  if (!parts.length) return empty('invalid-xml');
  const firstMeasures = directChildren(parts[0], 'measure');
  const normalized = range == null ? { start: 0, end: firstMeasures.length - 1 } : range;
  if (!Number.isInteger(normalized.start) || !Number.isInteger(normalized.end)
    || normalized.start < 0 || normalized.end < normalized.start) return empty('passage-empty');
  const last = Math.min(normalized.end, firstMeasures.length - 1);
  const originalMeasureIndices = Array.from(
    { length: Math.max(0, last - normalized.start + 1) },
    (_, offset) => normalized.start + offset,
  );
  if (!originalMeasureIndices.length) return empty('passage-empty');

  let inheritedBpm = null;
  for (const part of parts) {
    const measures = directChildren(part, 'measure');
    const inherited = effectiveAttributes(document, measures, normalized.start);
    const bpm = effectiveTempo(measures, normalized.start);
    if (inheritedBpm == null && bpm != null) inheritedBpm = bpm;
    const selected = measures.slice(normalized.start, normalized.end + 1);
    for (const measure of measures) if (!selected.includes(measure)) measure.remove();
    if (!selected.length) continue;
    const first = selected[0];
    const direction = tempoDirection(document, bpm);
    if (direction) first.insertBefore(direction, first.firstChild);
    if (inherited) first.insertBefore(inherited, first.firstChild);
    for (const measure of selected) removeForcedBreaks(measure);
  }

  return {
    musicXml: new XMLSerializer().serializeToString(document),
    originalMeasureIndices,
    inheritedTempoMap: inheritedBpm == null ? [] : [{ onsetQuarter: 0, bpm: inheritedBpm }],
    error: null,
  };
}

const partCode = (globalStaffIndex) => (globalStaffIndex === 0 ? 'rh' : globalStaffIndex === 1 ? 'lh' : `p${globalStaffIndex + 1}`);

function staffCount(part) {
  const declared = Math.max(0, ...[...part.getElementsByTagName('staves')].map((node) => Number(node.textContent) || 0));
  const used = Math.max(0, ...[...part.querySelectorAll('note > staff')].map((node) => Number(node.textContent) || 0));
  return Math.max(1, declared, used);
}

function remapNumberedChildren(attributes, name, mapping) {
  for (const child of directChildren(attributes, name)) {
    const oldNumber = Number(child.getAttribute('number') || 1);
    if (!mapping.has(oldNumber)) child.remove();
    else child.setAttribute('number', String(mapping.get(oldNumber)));
  }
}

/** Remove unrequested score staves/parts before engraving, returning the original staff mapping. */
export function selectMusicXmlParts(musicXml, requestedParts) {
  if (!Array.isArray(requestedParts) || !requestedParts.length) {
    return { musicXml, originalStaffIndices: null, error: null };
  }
  const document = new DOMParser().parseFromString(musicXml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) {
    return { musicXml: null, originalStaffIndices: [], error: 'invalid-xml' };
  }
  const selectedCodes = new Set(requestedParts);
  const originalStaffIndices = [];
  let globalOffset = 0;

  for (const part of [...document.getElementsByTagName('part')]) {
    const count = staffCount(part);
    const selectedLocal = Array.from({ length: count }, (_, index) => index + 1)
      .filter((local) => selectedCodes.has(partCode(globalOffset + local - 1)));
    if (!selectedLocal.length) {
      const id = part.getAttribute('id');
      part.remove();
      for (const definition of [...document.getElementsByTagName('score-part')]) {
        if (definition.getAttribute('id') === id) definition.remove();
      }
      globalOffset += count;
      continue;
    }

    const mapping = new Map(selectedLocal.map((oldNumber, index) => [oldNumber, index + 1]));
    for (const local of selectedLocal) originalStaffIndices.push(globalOffset + local - 1);
    if (selectedLocal.length !== count) {
      for (const measure of directChildren(part, 'measure')) {
        for (const note of directChildren(measure, 'note')) {
          const oldNumber = Number(note.querySelector(':scope > staff')?.textContent || 1);
          if (!mapping.has(oldNumber)) note.remove();
          else {
            const staff = note.querySelector(':scope > staff');
            if (staff) staff.textContent = String(mapping.get(oldNumber));
          }
        }
        for (const direction of directChildren(measure, 'direction')) {
          const staff = direction.querySelector(':scope > staff');
          if (!staff) continue;
          const oldNumber = Number(staff.textContent || 1);
          if (!mapping.has(oldNumber)) direction.remove();
          else staff.textContent = String(mapping.get(oldNumber));
        }
        if (selectedLocal.length === 1) {
          for (const cursorMove of [...directChildren(measure, 'backup'), ...directChildren(measure, 'forward')]) cursorMove.remove();
        }
        for (const attributes of directChildren(measure, 'attributes')) {
          for (const staves of directChildren(attributes, 'staves')) staves.textContent = String(selectedLocal.length);
          remapNumberedChildren(attributes, 'clef', mapping);
          remapNumberedChildren(attributes, 'staff-details', mapping);
        }
      }
    }
    globalOffset += count;
  }

  if (!document.getElementsByTagName('part').length) {
    return { musicXml: null, originalStaffIndices: [], error: 'parts-empty' };
  }
  return { musicXml: new XMLSerializer().serializeToString(document), originalStaffIndices, error: null };
}
