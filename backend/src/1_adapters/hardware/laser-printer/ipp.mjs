/**
 * Minimal IPP/1.1 (RFC 8010/8011) binary encoding — just enough to submit a
 * Print-Job and read Get-Printer-Attributes from an AirPrint-class printer.
 * No external deps: the wire format is a fixed header, tagged attribute
 * groups, then the document bytes.
 *
 * Encoding shape (request):
 *   version(2) operation(2) request-id(4)
 *   0x01 operation-attributes-tag
 *     [tag(1) nameLen(2) name valueLen(2) value] ...
 *   0x03 end-of-attributes
 *   <document bytes>
 */

export const OPS = {
  PRINT_JOB: 0x0002,
  GET_PRINTER_ATTRIBUTES: 0x000b,
};

const TAGS = {
  OPERATION_ATTRS: 0x01,
  END: 0x03,
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  TEXT: 0x41,
  NAME: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  CHARSET: 0x47,
  LANGUAGE: 0x48,
  MIME_TYPE: 0x49,
};

function attr(tag, name, value) {
  const nameBuf = Buffer.from(name, 'utf8');
  const valueBuf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const out = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valueBuf.length);
  let o = 0;
  out.writeUInt8(tag, o); o += 1;
  out.writeUInt16BE(nameBuf.length, o); o += 2;
  nameBuf.copy(out, o); o += nameBuf.length;
  out.writeUInt16BE(valueBuf.length, o); o += 2;
  valueBuf.copy(out, o);
  return out;
}

function int32(tag, name, value) {
  const v = Buffer.alloc(4);
  v.writeInt32BE(value);
  return attr(tag, name, v);
}

/**
 * Encode an IPP request. `operationAttrs` is an ordered list of
 * {tag, name, value} — order matters: RFC 8011 requires charset, then
 * natural-language, then the rest.
 *
 * @param {number} operation - an OPS value
 * @param {Array<{tag:number, name:string, value:*}>} operationAttrs
 * @param {?Buffer} document - document bytes (Print-Job) or null
 * @param {number} [requestId=1]
 * @returns {Buffer}
 */
export function encodeRequest(operation, operationAttrs, document = null, requestId = 1) {
  const head = Buffer.alloc(8);
  head.writeUInt8(1, 0); head.writeUInt8(1, 1); // IPP/1.1
  head.writeUInt16BE(operation, 2);
  head.writeUInt32BE(requestId, 4);

  const parts = [head, Buffer.from([TAGS.OPERATION_ATTRS])];
  for (const { tag, name, value } of operationAttrs) {
    parts.push(tag === TAGS.INTEGER ? int32(tag, name, value) : attr(tag, name, value));
  }
  parts.push(Buffer.from([TAGS.END]));
  if (document) parts.push(document);
  return Buffer.concat(parts);
}

/** The standard operation-attribute preamble every request starts with. */
export function baseAttrs(printerUri, user) {
  return [
    { tag: TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
    { tag: TAGS.LANGUAGE, name: 'attributes-natural-language', value: 'en' },
    { tag: TAGS.URI, name: 'printer-uri', value: printerUri },
    { tag: TAGS.NAME, name: 'requesting-user-name', value: user },
  ];
}

export function printJobAttrs(printerUri, { user, jobName, copies, documentFormat = 'application/octet-stream' }) {
  const attrs = baseAttrs(printerUri, user);
  attrs.push({ tag: TAGS.NAME, name: 'job-name', value: jobName });
  // `application/octet-stream` = let the printer auto-detect from the bytes.
  // Many AirPrint/IPP-Everywhere printers (e.g. Brother HL-L2460DW) do NOT
  // advertise `application/pdf` in document-format-supported and reject an
  // explicit PDF format with 0x040a (document-format-not-supported), even
  // though their firmware happily renders a PDF once it sniffs the %PDF
  // header. octet-stream is the universal, always-supported default.
  attrs.push({ tag: TAGS.MIME_TYPE, name: 'document-format', value: documentFormat });
  if (copies && copies > 1) {
    // copies is a JOB attribute, but Brother/AirPrint accept it in the
    // operation group for Print-Job; keep 1-copy jobs attribute-free.
    attrs.push({ tag: TAGS.INTEGER, name: 'copies', value: copies });
  }
  return attrs;
}

/**
 * Decode an IPP response far enough to act on it: status code plus a flat
 * name→value(s) map of every attribute we can read (integers, enums,
 * booleans, and string-ish tags). Unknown value tags are skipped by length —
 * the wire format makes every attribute skippable without understanding it.
 *
 * @param {Buffer} buf
 * @returns {{statusCode:number, ok:boolean, attrs:Object<string, Array>}}
 */
export function decodeResponse(buf) {
  if (!buf || buf.length < 9) return { statusCode: -1, ok: false, attrs: {} };
  const statusCode = buf.readUInt16BE(2);
  const attrs = {};
  let o = 8;
  let lastName = null;
  while (o < buf.length) {
    const tag = buf.readUInt8(o); o += 1;
    if (tag === TAGS.END) break;
    if (tag < 0x10) continue; // group delimiter — attribute groups just switch
    if (o + 2 > buf.length) break;
    const nameLen = buf.readUInt16BE(o); o += 2;
    const name = nameLen > 0 ? buf.toString('utf8', o, o + nameLen) : lastName; // 0-length = additional value
    o += nameLen;
    if (o + 2 > buf.length) break;
    const valueLen = buf.readUInt16BE(o); o += 2;
    if (o + valueLen > buf.length) break;
    let value;
    if ((tag === TAGS.INTEGER || tag === TAGS.ENUM) && valueLen === 4) value = buf.readInt32BE(o);
    else if (tag === TAGS.BOOLEAN && valueLen === 1) value = buf.readUInt8(o) === 1;
    else value = buf.toString('utf8', o, o + valueLen);
    o += valueLen;
    if (name) {
      (attrs[name] ||= []).push(value);
      lastName = name;
    }
  }
  return { statusCode, ok: statusCode <= 0x0002, attrs }; // successful-ok family
}
