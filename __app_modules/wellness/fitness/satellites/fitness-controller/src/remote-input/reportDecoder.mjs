/**
 * Generic input-report decoder, driven by a declarative spec from the device
 * inventory (input.yml `controllers[].report_decoder`). Knows no device.
 *
 *   report_decoder:
 *     att_handle: 0x001f            # which report channel carries it
 *     buttons:                      # control name -> one bit (or bits) of one byte
 *       ButtonA: { byte: 0, mask: 0x10 }
 *     axes:                         # an n-bit field -> control names by value
 *       - { byte: 1, shift: 6, bits: 2, values: { 0: StickUp, 2: StickDown } }
 *
 * A control is "on" when its bit is set / its field holds that value; anything
 * else (e.g. an axis at centre) is "off". Press/release come from diffing two
 * decoded states.
 */

const int = (v) => {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(v.trim())) return Number(v.trim());
  return null;
};

/**
 * Validate one inventory entry -> { address, channel, buttons, axes } | null.
 * @param {{ address?: string, report_decoder?: object }} entry
 */
export function normalizeDecoder(entry) {
  const spec = entry?.report_decoder;
  const address = typeof entry?.address === 'string' ? entry.address.trim().toUpperCase() : null;
  if (!spec || !address) return null;
  const channel = int(spec.att_handle);
  if (channel == null) return null;
  const buttons = [];
  for (const [control, b] of Object.entries(spec.buttons || {})) {
    const byte = int(b?.byte); const mask = int(b?.mask);
    if (byte != null && mask) buttons.push({ control, byte, mask });
  }
  const axes = [];
  for (const a of Array.isArray(spec.axes) ? spec.axes : []) {
    const byte = int(a?.byte); const shift = int(a?.shift ?? 0); const bits = int(a?.bits);
    if (byte == null || shift == null || !bits) continue;
    const values = [];
    for (const [v, control] of Object.entries(a.values || {})) {
      const n = int(v);
      if (n != null && typeof control === 'string') values.push({ value: n, control });
    }
    if (values.length) axes.push({ byte, shift, mask: (1 << bits) - 1, values });
  }
  if (!buttons.length && !axes.length) return null;
  return { address, channel, buttons, axes };
}

/** Every control a decoder can report, each false. */
function allOff(dec) {
  const s = {};
  for (const b of dec.buttons) s[b.control] = false;
  for (const a of dec.axes) for (const v of a.values) s[v.control] = false;
  return s;
}

/**
 * Bytes -> { control: on } for every control the spec names, or null when the
 * report is too short for it.
 * @param {ReturnType<typeof normalizeDecoder>} dec
 * @param {number[]} bytes
 */
export function decodeReport(dec, bytes) {
  const need = Math.max(...dec.buttons.map((b) => b.byte), ...dec.axes.map((a) => a.byte)) + 1;
  if (bytes.length < need) return null;
  const s = allOff(dec);
  for (const b of dec.buttons) if (bytes[b.byte] & b.mask) s[b.control] = true;
  for (const a of dec.axes) {
    const v = (bytes[a.byte] >> a.shift) & a.mask;
    for (const x of a.values) if (x.value === v) s[x.control] = true;
  }
  return s;
}

/** Two decoded states -> [{ control, state }] presses and releases, in spec order. */
export function diffStates(before = {}, now) {
  const out = [];
  for (const [control, on] of Object.entries(now)) {
    if (on && !before[control]) out.push({ control, state: 'down' });
    else if (!on && before[control]) out.push({ control, state: 'up' });
  }
  return out;
}

/** Hex string ('1052') -> byte array. */
export function hexBytes(hex) {
  return typeof hex === 'string' ? (hex.match(/[0-9a-f]{2}/gi) || []).map((h) => parseInt(h, 16)) : [];
}
