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
  VALIDATE_JOB: 0x0004,
  GET_PRINTER_ATTRIBUTES: 0x000b,
};

const TAGS = {
  OPERATION_ATTRS: 0x01,
  END: 0x03,
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  RESOLUTION: 0x32,
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
 * RFC 8011 §5.1.14 resolution value: xres(4) yres(4) units(1) — 9 octets,
 * mirrors decodeResponse's structural read. Returns the raw VALUE bytes, not
 * a full attribute — callers push `{ tag: TAGS.RESOLUTION, name, value:
 * resolutionValue(...) }` onto the same operationAttrs list every other
 * attribute uses, since `encodeRequest` re-encodes every entry uniformly
 * from that `{tag, name, value}` shape (a pre-built attribute Buffer in that
 * list would desync the loop that reads `.tag`/`.name`/`.value` off each
 * entry).
 */
function resolutionValue({ xres, yres, units = 3 }) {
  const v = Buffer.alloc(9);
  v.writeInt32BE(xres, 0);
  v.writeInt32BE(yres, 4);
  v.writeUInt8(units, 8);
  return v;
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

/**
 * @param {string} printerUri
 * @param {Object} params
 * @param {string} params.user
 * @param {string} params.jobName
 * @param {number} [params.copies]
 * @param {string} params.documentFormat
 * @param {Object} [params.jobAttributes] - output of negotiate.mjs's `chooseJobAttributes`
 *   (trimmed further by `LaserPrinterAdapter#negotiateJobAttributes`, see
 *   that module's Incident #3 comment): already filtered to only the names
 *   the printer's own `job-creation-attributes-supported` listed. This
 *   function does not re-decide whether to send any of these — that
 *   decision, like the format decision above, belongs to negotiate.mjs; this
 *   is pure wire encoding.
 *
 *   Shared, unmodified, by BOTH Print-Job and Validate-Job (RFC 8011 §3.2.3
 *   defines Validate-Job as "identical to... Print-Job... except that a
 *   client supplies no document data and the Printer allocates no
 *   resources" — same operation-attribute group, same job-template
 *   attributes, just called with `document: null`). One encoder, two
 *   operations, is what makes it possible to ask "would you take this?"
 *   with exactly the bytes the real job would carry — see
 *   LaserPrinterAdapter.mjs's Incident #3.
 * @param {{xres:number,yres:number,units:number}} [params.jobAttributes.printerResolution]
 * @param {string} [params.jobAttributes.printColorMode]
 * @param {string} [params.jobAttributes.sides]
 * @param {string} [params.jobAttributes.media]
 */
export function printJobAttrs(printerUri, { user, jobName, copies, documentFormat, jobAttributes = {} }) {
  if (!documentFormat) {
    // No silent default here on purpose. `application/octet-stream` means
    // "printer, please guess the format from the bytes" — that guess is
    // exactly what printed a PDF's raw source as plain text and burned a
    // tray of paper (see LaserPrinterAdapter's header comment for the
    // incident). The caller (LaserPrinterAdapter) MUST negotiate a format
    // the target printer actually advertises in `document-format-supported`
    // and pass it explicitly; this function refuses to paper over that.
    throw new Error('printJobAttrs requires an explicit documentFormat — negotiate one, do not default to octet-stream');
  }
  const attrs = baseAttrs(printerUri, user);
  attrs.push({ tag: TAGS.NAME, name: 'job-name', value: jobName });
  attrs.push({ tag: TAGS.MIME_TYPE, name: 'document-format', value: documentFormat });
  if (copies && copies > 1) {
    // copies is a JOB attribute, but Brother/AirPrint accept it in the
    // operation group for Print-Job; keep 1-copy jobs attribute-free.
    attrs.push({ tag: TAGS.INTEGER, name: 'copies', value: copies });
  }
  // Incident #2 (see LaserPrinterAdapter/negotiate.mjs headers): getting the
  // document-format envelope right was not enough — a printer that agreed to
  // `image/urf` still silently dropped the job because the BYTES inside
  // didn't match what it separately declared for that envelope. Telling the
  // printer, via real job attributes, exactly what we rasterized to (not
  // just hoping it re-derives the same reading from the raster header) is
  // the other half of that fix; each of these is only ever present when
  // negotiate.mjs already confirmed the printer's job-creation-attributes-
  // supported names it.
  if (jobAttributes.printerResolution) {
    attrs.push({ tag: TAGS.RESOLUTION, name: 'printer-resolution', value: resolutionValue(jobAttributes.printerResolution) });
  }
  if (jobAttributes.printColorMode) {
    attrs.push({ tag: TAGS.KEYWORD, name: 'print-color-mode', value: jobAttributes.printColorMode });
  }
  if (jobAttributes.sides) {
    attrs.push({ tag: TAGS.KEYWORD, name: 'sides', value: jobAttributes.sides });
  }
  if (jobAttributes.media) {
    attrs.push({ tag: TAGS.KEYWORD, name: 'media', value: jobAttributes.media });
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
    // resolution (RFC 8011 §5.1.14): 9 octets — xres(4) yres(4) units(1),
    // units 3 = dots/inch, 4 = dots/cm. Printer-resolution-supported/-default
    // use this; decoding it structurally is what lets DPI selection avoid a
    // hard-coded number (see negotiate.mjs's chooseResolution).
    else if (tag === TAGS.RESOLUTION && valueLen === 9) {
      value = { xres: buf.readInt32BE(o), yres: buf.readInt32BE(o + 4), units: buf.readUInt8(o + 8) };
    } else value = buf.toString('utf8', o, o + valueLen);
    o += valueLen;
    if (name) {
      (attrs[name] ||= []).push(value);
      lastName = name;
    }
  }
  return { statusCode, ok: statusCode <= 0x0002, attrs }; // successful-ok family
}
