import QRCode from 'qrcode';

export const SCHOOL_QR_PREFIX = 'sch:';
export const SCHOOL_RESULT_QR_PREFIX = 'sch:r1:';
export const TI86_FRAME_WIDTH = 128;
export const TI86_FRAME_HEIGHT = 64;
export const TI86_FRAME_BYTES = 1024;

const ACTION_TOKEN = /^sch:[2-9A-HJ-NP-Z]{16}$/;
const RESULT_RECORD = /^sch:r1:[A-Z2-7]+$/;

/**
 * The visible QR has two deliberately different density profiles.
 *
 * Action tokens are short and get 2x modules. Result records preserve EC-M and
 * use the proven Version-9 ceiling: 53 modules + 4-module quiet zones = 61 px.
 */
export function createSchoolCalcQrFrame(payload) {
  const kind = classifySchoolQrPayload(payload);
  const profile = kind === 'action'
    ? { errorCorrectionLevel: 'L', scale: 2, maxVersion: 1 }
    : { errorCorrectionLevel: 'M', scale: 1, maxVersion: 9 };
  const qr = QRCode.create(payload, { errorCorrectionLevel: profile.errorCorrectionLevel });
  if (qr.version > profile.maxVersion) {
    throw new Error(
      `SchoolCalc ${kind} QR needs Version ${qr.version}; TI-86 profile allows Version ${profile.maxVersion}`,
    );
  }

  const quietModules = 4;
  const occupiedPixels = (qr.modules.size + quietModules * 2) * profile.scale;
  if (occupiedPixels > TI86_FRAME_HEIGHT) {
    throw new Error(`SchoolCalc QR occupies ${occupiedPixels}px; TI-86 display is ${TI86_FRAME_HEIGHT}px high`);
  }
  const originX = Math.floor((TI86_FRAME_WIDTH - occupiedPixels) / 2) + quietModules * profile.scale;
  const originY = Math.floor((TI86_FRAME_HEIGHT - occupiedPixels) / 2) + quietModules * profile.scale;
  const bytes = new Uint8Array(TI86_FRAME_BYTES);
  const pixels = Array.from({ length: TI86_FRAME_HEIGHT }, () => Array(TI86_FRAME_WIDTH).fill(false));

  const setPixel = (x, y) => {
    pixels[y][x] = true;
    bytes[y * 16 + Math.floor(x / 8)] |= 0x80 >> (x & 7);
  };
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.get(row, column)) continue;
      for (let dy = 0; dy < profile.scale; dy += 1) {
        for (let dx = 0; dx < profile.scale; dx += 1) {
          setPixel(originX + column * profile.scale + dx, originY + row * profile.scale + dy);
        }
      }
    }
  }

  return {
    kind,
    payload,
    version: qr.version,
    errorCorrectionLevel: profile.errorCorrectionLevel,
    moduleCount: qr.modules.size,
    moduleScale: profile.scale,
    quietModules,
    occupiedPixels,
    origin: { x: originX, y: originY },
    bytes,
    rows: pixels.map((row) => row.map((value) => (value ? '█' : '.')).join('')),
  };
}

export function classifySchoolQrPayload(payload) {
  if (typeof payload !== 'string') throw new Error('SchoolCalc QR payload must be text');
  if (RESULT_RECORD.test(payload)) return 'result';
  if (ACTION_TOKEN.test(payload)) return 'action';
  if (!payload.startsWith(SCHOOL_QR_PREFIX)) {
    throw new Error('SchoolCalc QR payload must start with sch:');
  }
  throw new Error('SchoolCalc QR payload is neither an opaque action token nor an r1 result record');
}

export function toAssemblyInclude(frame, { label = 'SCHOOL_QR_FRAME' } = {}) {
  if (!(frame?.bytes instanceof Uint8Array) || frame.bytes.length !== TI86_FRAME_BYTES) {
    throw new Error(`SchoolCalc QR frame must contain ${TI86_FRAME_BYTES} bytes`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(label)) throw new Error('assembly label must be uppercase');
  const hex = (value) => `$${value.toString(16).padStart(2, '0').toUpperCase()}`;
  const lines = [
    `; SchoolCalc ${frame.kind} QR: ${frame.payload}`,
    `; V${frame.version}/EC-${frame.errorCorrectionLevel}, ${frame.moduleCount} modules at ${frame.moduleScale}x.`,
    `${label}:`,
  ];
  for (let offset = 0; offset < frame.bytes.length; offset += 16) {
    lines.push(`    .db ${[...frame.bytes.slice(offset, offset + 16)].map(hex).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
