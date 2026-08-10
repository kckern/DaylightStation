const GRAPHIC_TYPES = new Set(['line', 'polyline', 'rect', 'circle', 'point', 'label']);
const FACE_KEYS = ['promptGraphic', 'answerGraphic'];
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/** Validate target-neutral, normalized vector art authored on an adaptive item. */
export function adaptiveGraphicReason(itemSchoolCalc, { path = 'schoolcalc' } = {}) {
  if (itemSchoolCalc === undefined) return null;
  if (!isObject(itemSchoolCalc)) return `${path} must be a mapping`;
  for (const face of FACE_KEYS) {
    const graphic = itemSchoolCalc[face];
    if (graphic === undefined) continue;
    const reason = graphicReason(graphic, `${path}.${face}`);
    if (reason) return reason;
  }
  return null;
}

function graphicReason(graphic, path) {
  if (!isObject(graphic) || !Array.isArray(graphic.primitives)
      || graphic.primitives.length < 1 || graphic.primitives.length > 24) {
    return `${path}.primitives must contain 1..24 vector primitives`;
  }
  for (let index = 0; index < graphic.primitives.length; index += 1) {
    const primitive = graphic.primitives[index];
    const at = `${path}.primitives[${index}]`;
    if (!isObject(primitive) || !GRAPHIC_TYPES.has(primitive.type)) {
      return `${at}.type must be line|polyline|rect|circle|point|label`;
    }
    const reason = primitiveReason(primitive, at);
    if (reason) return reason;
  }
  return null;
}

function primitiveReason(primitive, path) {
  if (primitive.type === 'line') {
    return coordinatesReason(primitive, ['x1', 'y1', 'x2', 'y2'], path);
  }
  if (primitive.type === 'polyline') {
    if (!Array.isArray(primitive.points) || primitive.points.length < 2 || primitive.points.length > 16) {
      return `${path}.points must contain 2..16 points`;
    }
    for (let index = 0; index < primitive.points.length; index += 1) {
      const reason = coordinatesReason(primitive.points[index], ['x', 'y'], `${path}.points[${index}]`);
      if (reason) return reason;
    }
    return null;
  }
  if (primitive.type === 'rect') {
    const reason = coordinatesReason(primitive, ['x', 'y'], path);
    if (reason) return reason;
    if (!integerInRange(primitive.width, 1, 100) || !integerInRange(primitive.height, 1, 100)
        || primitive.x + primitive.width > 100 || primitive.y + primitive.height > 100) {
      return `${path} rectangle must remain inside normalized 0..100 bounds`;
    }
    return null;
  }
  if (primitive.type === 'circle') {
    const reason = coordinatesReason(primitive, ['cx', 'cy'], path);
    if (reason) return reason;
    if (!integerInRange(primitive.radius, 1, 50)
        || primitive.cx - primitive.radius < 0 || primitive.cx + primitive.radius > 100
        || primitive.cy - primitive.radius < 0 || primitive.cy + primitive.radius > 100) {
      return `${path} circle must remain inside normalized 0..100 bounds`;
    }
    return null;
  }
  if (primitive.type === 'point') return coordinatesReason(primitive, ['x', 'y'], path);
  const reason = coordinatesReason(primitive, ['x', 'y'], path);
  if (reason) return reason;
  if (typeof primitive.text !== 'string' || !PRINTABLE_ASCII.test(primitive.text)
      || primitive.text.length > 12) {
    return `${path}.text must contain 1..12 printable ASCII characters`;
  }
  return null;
}

function coordinatesReason(value, keys, path) {
  if (!isObject(value) || keys.some((key) => !integerInRange(value[key], 0, 100))) {
    return `${path} coordinates must be integers from 0..100`;
  }
  return null;
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export default adaptiveGraphicReason;
