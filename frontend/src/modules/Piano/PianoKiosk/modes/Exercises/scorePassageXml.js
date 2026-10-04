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
  const sound = document.createElement('sound');
  sound.setAttribute('tempo', String(bpm));
  direction.appendChild(sound);
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
