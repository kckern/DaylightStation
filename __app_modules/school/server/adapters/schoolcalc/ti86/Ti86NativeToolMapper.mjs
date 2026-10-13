/**
 * Compile portable SchoolCalc tool modules into closed TI-86 native plans.
 *
 * The School application validates portable schemas. This adapter performs the
 * stricter family mapping: logical equation slots become y1..y4, expressions
 * become a deliberately small equation-token grammar, numbers become TI-86
 * ten-byte reals, and native programs can only come from an injected allowlist.
 * No authored variable name, program name, BASIC source, assembly, or ROM
 * address is copied into the plan.
 */

export const TI86_NATIVE_PLAN_SCHEMA = 'school.calc.ti86-native-plan/v1';
export const TI86_NATIVE_MAX_EXPRESSION_BYTES = 192;
export const TI86_NATIVE_MAX_EXPRESSION_DEPTH = 16;
export const TI86_NATIVE_MAX_EQUATIONS = 4;
export const TI86_NATIVE_MAX_PROGRAM_ARGS = 8;
export const TI86_NATIVE_MAX_PAYLOAD_BYTES = 1152;
// Restrict the wider TI real exponent to the finite, 14-significant-digit
// range that round-trips exactly through the adapter's JavaScript Number
// boundary. The Z80 semantic guard enforces the same excess-$FC00 bounds.
export const TI86_NATIVE_REAL_MIN_EXPONENT = -308;
export const TI86_NATIVE_REAL_MAX_EXPONENT = 307;

export const TI86_NATIVE_OPERATION = Object.freeze({
  calculator: 1,
  graph: 2,
  table: 3,
  solver: 4,
  matrix: 5,
  equationEditor: 6,
  nativeProgram: 7,
});

export const TI86_NATIVE_LAUNCH = Object.freeze({
  home: 1,
  graph: 2,
  table: 3,
  solver: 4,
  matrixEditor: 5,
  equationEditor: 6,
  basicProgram: 7,
});

export const TI86_NATIVE_SNAPSHOT_RESOURCE = Object.freeze({
  homeEntry: 1,
  functionGraphDatabase: 2,
  tableSettings: 3,
  solverState: 4,
  matrixWorkspace: 5,
  nativeProgramWorkspace: 6,
});

const CAPABILITY = Object.freeze({
  'calculator@1': 'calculator',
  'graph@1': 'graph',
  'table@1': 'table',
  'solver@1': 'solver',
  'matrix@1': 'matrix',
  'equation-editor@1': 'equationEditor',
  'native-program@1': 'nativeProgram',
});

const LOGICAL_EQUATION_SLOT = Object.freeze({
  primary: 1,
  secondary: 2,
  tertiary: 3,
  quaternary: 4,
});

// Token values are from the TI-86 token table. Only this expression subset is
// accepted; adding a token is a reviewed adapter change, never content policy.
const TOKEN = Object.freeze({
  leftParen: 0x10,
  rightParen: 0x11,
  variable: 0x32,
  equals: 0x3F,
  pi: 0x42,
  literalNumber: 0x44,
  plus: 0x60,
  minus: 0x61,
  multiply: 0x70,
  divide: 0x71,
  negate: 0xA0,
  abs: 0xA2,
  ln: 0xA6,
  exp: 0xA7,
  log: 0xA8,
  pow10: 0xA9,
  sin: 0xAA,
  cos: 0xAC,
  tan: 0xAE,
  power: 0xF0,
});

const FUNCTION_TOKEN = Object.freeze({
  abs: TOKEN.abs,
  ln: TOKEN.ln,
  exp: TOKEN.exp,
  log: TOKEN.log,
  pow10: TOKEN.pow10,
  sin: TOKEN.sin,
  cos: TOKEN.cos,
  tan: TOKEN.tan,
});

const CONFIG_KEYS = Object.freeze({
  calculator: ['expression'],
  graph: ['equations', 'window'],
  table: ['expressions', 'start', 'step'],
  solver: ['equation', 'variable', 'initial'],
  matrix: ['matrices'],
  equationEditor: ['equations'],
  nativeProgram: ['toolId', 'args'],
});

const OPERATION_NAME_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(TI86_NATIVE_OPERATION).map(([name, code]) => [code, name]),
));

const LAUNCH_BY_OPERATION = Object.freeze({
  calculator: TI86_NATIVE_LAUNCH.home,
  graph: TI86_NATIVE_LAUNCH.graph,
  table: TI86_NATIVE_LAUNCH.table,
  solver: TI86_NATIVE_LAUNCH.solver,
  matrix: TI86_NATIVE_LAUNCH.matrixEditor,
  equationEditor: TI86_NATIVE_LAUNCH.equationEditor,
  nativeProgram: TI86_NATIVE_LAUNCH.basicProgram,
});

const SNAPSHOT_BY_OPERATION = Object.freeze({
  calculator: Object.freeze([TI86_NATIVE_SNAPSHOT_RESOURCE.homeEntry]),
  graph: Object.freeze([TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase]),
  table: Object.freeze([
    TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase,
    TI86_NATIVE_SNAPSHOT_RESOURCE.tableSettings,
  ]),
  solver: Object.freeze([TI86_NATIVE_SNAPSHOT_RESOURCE.solverState]),
  matrix: Object.freeze([TI86_NATIVE_SNAPSHOT_RESOURCE.matrixWorkspace]),
  equationEditor: Object.freeze([TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase]),
});

const RESOURCE_NAME_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(TI86_NATIVE_SNAPSHOT_RESOURCE).map(([name, code]) => [code, name]),
));

export class Ti86NativeToolMapper {
  #programs;

  constructor({ programs = {} } = {}) {
    this.#programs = normalizeProgramAllowlist(programs);
  }

  map(module) {
    if (!module || module.type !== 'tool' || typeof module.capability !== 'string') {
      throw new Error('TI-86 native mapper requires a tool module');
    }
    const operationName = CAPABILITY[module.capability];
    if (!operationName) throw new Error(`unsupported TI-86 native capability '${module.capability}'`);
    const config = plainObject(module.config, `${module.capability} config`);
    assertExactKeys(config, CONFIG_KEYS[operationName], `${module.capability} config`);

    let mapped;
    switch (operationName) {
      case 'calculator': mapped = mapCalculator(config); break;
      case 'graph': mapped = mapGraph(config); break;
      case 'table': mapped = mapTable(config); break;
      case 'solver': mapped = mapSolver(config); break;
      case 'matrix': mapped = mapMatrix(config); break;
      case 'equationEditor': mapped = mapEquationEditor(config); break;
      case 'nativeProgram': mapped = mapNativeProgram(config, this.#programs); break;
      default: throw new Error(`unsupported TI-86 native operation '${operationName}'`);
    }

    const plan = Object.freeze({
      schema: TI86_NATIVE_PLAN_SCHEMA,
      version: 1,
      operation: TI86_NATIVE_OPERATION[operationName],
      launch: mapped.launch,
      snapshot: Object.freeze([...new Set(mapped.snapshot)].sort((a, b) => a - b)),
      payload: Buffer.from(mapped.payload),
    });
    // Encoder and runtime decoder are one contract. Never emit a plan the
    // fail-closed calculator boundary would reject.
    decodeNativePlan(plan, this.#programs);
    return plan;
  }

  decode(plan) {
    return decodeNativePlan(plan, this.#programs);
  }

  reasons(module) {
    try { this.map(module); return []; }
    catch (error) { return [error.message]; }
  }
}

export function createTi86NativeToolMapper(options) {
  return new Ti86NativeToolMapper(options);
}

/**
 * Validate and decode a closed native plan exactly as the TI runtime must.
 * Native BASIC programs are disabled unless the same reviewed allowlist used
 * by the compiler is supplied here.
 */
export function decodeTi86NativePlan(plan, { programs = {} } = {}) {
  return decodeNativePlan(plan, normalizeProgramAllowlist(programs));
}

function decodeNativePlan(plan, programs) {
  const value = plainObject(plan, 'TI-86 native plan');
  assertExactKeys(value, ['schema', 'version', 'operation', 'launch', 'snapshot', 'payload'], 'TI-86 native plan');
  const operationName = OPERATION_NAME_BY_CODE[value.operation];
  if (value.schema !== TI86_NATIVE_PLAN_SCHEMA || value.version !== 1 || !operationName) {
    throw new Error('TI-86 native plan schema, version, or operation is invalid');
  }
  const expectedLaunch = LAUNCH_BY_OPERATION[operationName];
  if (value.launch !== expectedLaunch) {
    throw new Error(`TI-86 native ${operationName} plan has an invalid launch target`);
  }
  if (!Array.isArray(value.snapshot) || value.snapshot.length < 1) {
    throw new Error('TI-86 native plan snapshot must be a non-empty array');
  }
  const snapshot = [...value.snapshot];
  if (!snapshot.every((code) => Number.isInteger(code) && RESOURCE_NAME_BY_CODE[code])
      || new Set(snapshot).size !== snapshot.length
      || snapshot.some((code, index) => index > 0 && code <= snapshot[index - 1])) {
    throw new Error('TI-86 native plan snapshot resources are invalid or noncanonical');
  }
  if (!Buffer.isBuffer(value.payload) || value.payload.length > TI86_NATIVE_MAX_PAYLOAD_BYTES) {
    throw new Error(`TI-86 native plan payload must be a Buffer of at most ${TI86_NATIVE_MAX_PAYLOAD_BYTES} bytes`);
  }

  const reader = new NativePayloadReader(value.payload, operationName);
  let decoded;
  switch (operationName) {
    case 'calculator': decoded = decodeCalculatorPayload(reader); break;
    case 'graph': decoded = decodeGraphPayload(reader); break;
    case 'table': decoded = decodeTablePayload(reader); break;
    case 'solver': decoded = decodeSolverPayload(reader); break;
    case 'matrix': decoded = decodeMatrixPayload(reader); break;
    case 'equationEditor': decoded = decodeEquationEditorPayload(reader); break;
    case 'nativeProgram': decoded = decodeNativeProgramPayload(reader, programs); break;
    default: throw new Error(`TI-86 native operation '${operationName}' has no decoder`);
  }
  reader.done();

  const expectedSnapshot = operationName === 'nativeProgram'
    ? decoded.definition.snapshot
    : SNAPSHOT_BY_OPERATION[operationName];
  if (!sameNumbers(snapshot, expectedSnapshot)) {
    throw new Error(`TI-86 native ${operationName} plan snapshot does not match its mutation contract`);
  }

  return Object.freeze({
    schema: TI86_NATIVE_PLAN_SCHEMA,
    version: 1,
    capability: operationName,
    operation: value.operation,
    launch: value.launch,
    snapshot: Object.freeze(snapshot),
    resources: Object.freeze(snapshot.map((code) => RESOURCE_NAME_BY_CODE[code])),
    payload: Buffer.from(value.payload),
    decoded,
  });
}

function decodeCalculatorPayload(reader) {
  const expressions = reader.expressions('calculator expression', {
    minimum: 1, maximum: 1, allowEmpty: true, variables: ['x'],
  });
  return Object.freeze({ expression: expressions[0] });
}

function decodeGraphPayload(reader) {
  const count = reader.count('equation count', 1, TI86_NATIVE_MAX_EQUATIONS);
  const slots = new Set();
  const equations = [];
  for (let index = 0; index < count; index += 1) {
    const slot = reader.count(`equation ${index} slot`, 1, TI86_NATIVE_MAX_EQUATIONS);
    if (slots.has(slot)) throw new Error(`TI-86 native graph payload repeats equation slot ${slot}`);
    slots.add(slot);
    const tokens = reader.byteString(`equation ${index}`, 1, TI86_NATIVE_MAX_EXPRESSION_BYTES);
    validateTi86NativeExpressionTokens(tokens, { variables: ['x'] });
    equations.push(Object.freeze({ slot, tokens }));
  }
  const mask = reader.u8('window mask');
  let window = null;
  if (mask === 0x0F) {
    const xMin = reader.real('window xMin');
    const xMax = reader.real('window xMax');
    const yMin = reader.real('window yMin');
    const yMax = reader.real('window yMax');
    if (xMin >= xMax || yMin >= yMax) throw new Error('TI-86 native graph window bounds are invalid');
    window = Object.freeze({ xMin, xMax, yMin, yMax });
  } else if (mask !== 0) {
    throw new Error('TI-86 native graph window mask is invalid');
  }
  return Object.freeze({ equations: Object.freeze(equations), window });
}

function decodeTablePayload(reader) {
  const expressions = reader.expressions('table expression', {
    minimum: 1, maximum: TI86_NATIVE_MAX_EQUATIONS, variables: ['x'],
  });
  const start = reader.real('table start');
  const step = reader.real('table step');
  if (step === 0) throw new Error('TI-86 native table step must be non-zero');
  return Object.freeze({ expressions, start, step });
}

function decodeSolverPayload(reader) {
  const encodedEquations = reader.byteStrings('solver equation', 1, 1, 1, TI86_NATIVE_MAX_EXPRESSION_BYTES);
  const variableLength = reader.count('solver variable length', 1, 8);
  const variable = reader.ascii(variableLength, 'solver variable');
  if (variable !== 'x' && !/^[A-Z][A-Z0-9]{0,7}$/.test(variable)) {
    throw new Error('TI-86 native solver variable is invalid or noncanonical');
  }
  validateTi86NativeExpressionTokens(encodedEquations[0], {
    variables: [variable], allowEquation: true,
  });
  const initialFlag = reader.u8('solver initial flag');
  if (initialFlag !== 0 && initialFlag !== 1) throw new Error('TI-86 native solver initial flag is invalid');
  const initial = initialFlag ? reader.real('solver initial') : null;
  return Object.freeze({ equation: encodedEquations[0], variable, initial });
}

function decodeMatrixPayload(reader) {
  const count = reader.count('matrix count', 1, 3);
  const matrices = [];
  for (let index = 0; index < count; index += 1) {
    const slot = reader.u8(`matrix ${index} slot`);
    if (slot !== index + 1) throw new Error(`TI-86 native matrix ${index} slot is noncanonical`);
    const rows = reader.count(`matrix ${index} rows`, 1, 6);
    const columns = reader.count(`matrix ${index} columns`, 1, 6);
    const values = [];
    for (let row = 0; row < rows; row += 1) {
      const cells = [];
      for (let column = 0; column < columns; column += 1) {
        cells.push(reader.real(`matrix ${index} cell ${row},${column}`));
      }
      values.push(Object.freeze(cells));
    }
    matrices.push(Object.freeze({ slot, rows, columns, values: Object.freeze(values) }));
  }
  return Object.freeze({ matrices: Object.freeze(matrices) });
}

function decodeEquationEditorPayload(reader) {
  const equations = reader.expressions('equation-editor expression', {
    minimum: 1, maximum: TI86_NATIVE_MAX_EQUATIONS, variables: ['x'],
  });
  return Object.freeze({ equations });
}

function decodeNativeProgramPayload(reader, programs) {
  const nameLength = reader.count('program name length', 1, 8);
  const programName = reader.ascii(nameLength, 'program name');
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(programName)) {
    throw new Error('TI-86 native program name is invalid');
  }
  const definitionEntry = [...programs.entries()].find(([, definition]) => (
    definition.programName === programName
  ));
  if (!definitionEntry) {
    throw new Error(`TI-86 native program '${programName}' is not runtime-allowlisted`);
  }
  const [toolId, definition] = definitionEntry;
  const count = reader.count('program argument count', 0, TI86_NATIVE_MAX_PROGRAM_ARGS);
  if (count > definition.maxArgs || (definition.argumentKinds && count !== definition.argumentKinds.length)) {
    throw new Error(`TI-86 native program '${programName}' argument count is invalid`);
  }
  const args = [];
  const kinds = [];
  for (let index = 0; index < count; index += 1) {
    const kindCode = reader.u8(`program argument ${index} kind`);
    if (kindCode === 1) {
      kinds.push('number');
      args.push(reader.real(`program argument ${index} number`));
    } else if (kindCode === 2) {
      kinds.push('string');
      const length = reader.count(`program argument ${index} string length`, 0, 32);
      const value = reader.ascii(length, `program argument ${index} string`);
      if (!/^[\x20-\x7E]*$/.test(value)) throw new Error(`TI-86 native program argument ${index} is not printable ASCII`);
      args.push(value);
    } else if (kindCode === 3) {
      kinds.push('boolean');
      const value = reader.u8(`program argument ${index} boolean`);
      if (value !== 0 && value !== 1) throw new Error(`TI-86 native program argument ${index} boolean is invalid`);
      args.push(value === 1);
    } else {
      throw new Error(`TI-86 native program argument ${index} kind is invalid`);
    }
  }
  if (definition.argumentKinds && !kinds.every((kind, index) => kind === definition.argumentKinds[index])) {
    throw new Error(`TI-86 native program '${programName}' argument kinds do not match its allowlist`);
  }
  return Object.freeze({
    toolId,
    programName,
    args: Object.freeze(args),
    argumentKinds: Object.freeze(kinds),
    definition,
  });
}

class NativePayloadReader {
  #bytes;
  #offset = 0;
  #label;

  constructor(bytes, label) {
    this.#bytes = Buffer.from(bytes);
    this.#label = label;
  }

  u8(name) {
    this.#need(1, name);
    return this.#bytes[this.#offset++];
  }

  count(name, minimum, maximum) {
    const value = this.u8(name);
    if (value < minimum || value > maximum) {
      throw new Error(`TI-86 native ${this.#label} ${name} must be ${minimum}..${maximum}`);
    }
    return value;
  }

  take(length, name) {
    this.#need(length, name);
    const value = Buffer.from(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  ascii(length, name) {
    const value = this.take(length, name);
    if (value.some((byte) => byte > 0x7F)) throw new Error(`TI-86 native ${this.#label} ${name} is not ASCII`);
    return value.toString('ascii');
  }

  byteString(name, minimum = 0, maximum = 0xFF) {
    const length = this.count(`${name} length`, minimum, maximum);
    return this.take(length, name);
  }

  byteStrings(name, minimumCount, maximumCount, minimumLength = 0, maximumLength = 0xFF) {
    const count = this.count(`${name} count`, minimumCount, maximumCount);
    const values = [];
    for (let index = 0; index < count; index += 1) {
      values.push(this.byteString(`${name} ${index}`, minimumLength, maximumLength));
    }
    return Object.freeze(values);
  }

  expressions(name, { minimum, maximum, allowEmpty = false, variables, allowEquation = false }) {
    const values = this.byteStrings(
      name,
      minimum,
      maximum,
      allowEmpty ? 0 : 1,
      TI86_NATIVE_MAX_EXPRESSION_BYTES,
    );
    values.forEach((tokens) => {
      if (tokens.length) validateTi86NativeExpressionTokens(tokens, { variables, allowEquation });
    });
    return values;
  }

  real(name) {
    const bytes = this.take(10, name);
    let value;
    try { value = decodeTi86Real(bytes); }
    catch (error) { throw new Error(`TI-86 native ${this.#label} ${name}: ${error.message}`); }
    if (!encodeTi86Real(value).equals(bytes)) {
      throw new Error(`TI-86 native ${this.#label} ${name} is not a canonical ten-byte real`);
    }
    return value;
  }

  done() {
    if (this.#offset !== this.#bytes.length) {
      throw new Error(`TI-86 native ${this.#label} payload contains trailing bytes`);
    }
  }

  #need(length, name) {
    if (!Number.isInteger(length) || length < 0 || this.#offset + length > this.#bytes.length) {
      throw new Error(`TI-86 native ${this.#label} payload is truncated at ${name}`);
    }
  }
}

function sameNumbers(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/** Encode a finite JS number in the TI-86 ten-byte real representation. */
export function encodeTi86Real(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('TI-86 real value must be finite');
  }
  if (Object.is(value, -0) || value === 0) return Buffer.from([0, 0x00, 0xFC, 0, 0, 0, 0, 0, 0, 0]);

  const negative = value < 0;
  const scientific = Math.abs(value).toExponential(13);
  const match = /^(\d)\.(\d{13})e([+-]\d+)$/.exec(scientific);
  if (!match) throw new Error('TI-86 real conversion failed');
  const exponent = Number(match[3]);
  if (!Number.isInteger(exponent)
      || exponent < TI86_NATIVE_REAL_MIN_EXPONENT
      || exponent > TI86_NATIVE_REAL_MAX_EXPONENT) {
    throw new Error(`TI-86 real exponent must be between ${TI86_NATIVE_REAL_MIN_EXPONENT} and ${TI86_NATIVE_REAL_MAX_EXPONENT}`);
  }
  const digits = `${match[1]}${match[2]}`;
  const bytes = Buffer.alloc(10);
  bytes[0] = negative ? 0x80 : 0;
  bytes.writeUInt16LE(0xFC00 + exponent, 1);
  for (let index = 0; index < 7; index += 1) {
    bytes[3 + index] = (Number(digits[index * 2]) << 4) | Number(digits[(index * 2) + 1]);
  }
  return bytes;
}

/** Decode the adapter-produced subset; useful for golden and mapper tests. */
export function decodeTi86Real(input) {
  const bytes = Buffer.from(input ?? []);
  if (bytes.length !== 10 || (bytes[0] & 0x7F) !== 0) throw new Error('TI-86 real bytes are invalid');
  const exponent = bytes.readUInt16LE(1) - 0xFC00;
  if (exponent < TI86_NATIVE_REAL_MIN_EXPONENT || exponent > TI86_NATIVE_REAL_MAX_EXPONENT) {
    throw new Error('TI-86 real exponent is outside the reviewed adapter range');
  }
  let digits = '';
  for (const byte of bytes.subarray(3)) {
    const high = byte >>> 4;
    const low = byte & 0x0F;
    if (high > 9 || low > 9) throw new Error('TI-86 real mantissa is invalid BCD');
    digits += `${high}${low}`;
  }
  if (/^0+$/.test(digits)) return 0;
  const magnitude = Number(`${digits[0]}.${digits.slice(1)}e${exponent}`);
  return (bytes[0] & 0x80) ? -magnitude : magnitude;
}

/** Compile the reviewed arithmetic grammar into TI-86 equation tokens. */
export function tokenizeTi86NativeExpression(expression, {
  variables = ['x'],
  allowEquation = false,
} = {}) {
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    throw new Error('TI-86 native expression must be non-empty text');
  }
  if (expression.length > TI86_NATIVE_MAX_EXPRESSION_BYTES) {
    throw new Error(`TI-86 native expression exceeds ${TI86_NATIVE_MAX_EXPRESSION_BYTES} source characters`);
  }
  const allowedVariables = new Map(variables.map((name) => {
    const normalized = normalizeVariableName(name);
    return [normalized.toLowerCase(), normalized];
  }));
  const parser = new Ti86ExpressionParser(expression, { allowedVariables, allowEquation });
  const bytes = Buffer.from(parser.parse());
  if (bytes.length > TI86_NATIVE_MAX_EXPRESSION_BYTES) {
    throw new Error(`TI-86 native expression exceeds ${TI86_NATIVE_MAX_EXPRESSION_BYTES} token bytes`);
  }
  validateTi86NativeExpressionTokens(bytes, { variables, allowEquation });
  return bytes;
}

/** Validate the exact token grammar accepted by the calculator runtime. */
export function validateTi86NativeExpressionTokens(input, {
  variables = ['x'],
  allowEquation = false,
} = {}) {
  const bytes = Buffer.from(input ?? []);
  if (bytes.length < 1 || bytes.length > TI86_NATIVE_MAX_EXPRESSION_BYTES) {
    throw new Error(`TI-86 native expression tokens must contain 1..${TI86_NATIVE_MAX_EXPRESSION_BYTES} bytes`);
  }
  const allowedVariables = new Set(variables.map((name) => normalizeVariableName(name)));
  new Ti86ExpressionTokenParser(bytes, { allowedVariables, allowEquation }).parse();
  return Buffer.from(bytes);
}

class Ti86ExpressionTokenParser {
  #bytes;
  #offset = 0;
  #allowedVariables;
  #allowEquation;

  constructor(bytes, { allowedVariables, allowEquation }) {
    this.#bytes = bytes;
    this.#allowedVariables = allowedVariables;
    this.#allowEquation = allowEquation;
  }

  parse() {
    this.#additive(0);
    if (this.#peek() === TOKEN.equals) {
      if (!this.#allowEquation) throw new Error("TI-86 native expression tokens do not allow '='");
      this.#offset += 1;
      this.#additive(0);
      if (this.#peek() === TOKEN.equals) throw new Error('TI-86 native expression tokens contain multiple equalities');
    }
    if (this.#offset !== this.#bytes.length) {
      throw new Error(`TI-86 native expression tokens contain unexpected byte 0x${this.#peek().toString(16)}`);
    }
  }

  #additive(depth) {
    this.#multiplicative(depth);
    while (this.#peek() === TOKEN.plus || this.#peek() === TOKEN.minus) {
      this.#offset += 1;
      this.#multiplicative(depth);
    }
  }

  #multiplicative(depth) {
    this.#power(depth);
    while (this.#peek() === TOKEN.multiply || this.#peek() === TOKEN.divide) {
      this.#offset += 1;
      this.#power(depth);
    }
  }

  #power(depth) {
    this.#bounded(depth);
    this.#unary(depth);
    if (this.#peek() === TOKEN.power) {
      this.#offset += 1;
      this.#power(depth + 1);
    }
  }

  #unary(depth) {
    this.#bounded(depth);
    if (this.#peek() === TOKEN.negate) {
      this.#offset += 1;
      this.#unary(depth + 1);
      return;
    }
    this.#primary(depth);
  }

  #primary(depth) {
    this.#bounded(depth);
    const token = this.#peek();
    if (token === undefined) throw new Error('TI-86 native expression tokens end unexpectedly');
    if (token === TOKEN.literalNumber) {
      this.#offset += 1;
      const start = this.#offset;
      while (this.#peek() !== 0 && this.#peek() !== undefined) this.#offset += 1;
      if (this.#peek() !== 0) throw new Error('TI-86 native numeric token is unterminated');
      const length = this.#offset - start;
      if (length < 1 || length > 24) throw new Error('TI-86 native numeric token length is invalid');
      const literalBytes = this.#bytes.subarray(start, this.#offset);
      if (literalBytes.some((byte) => byte > 0x7F)) throw new Error('TI-86 native numeric token is not ASCII');
      const literal = literalBytes.toString('ascii');
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal) || !Number.isFinite(Number(literal))) {
        throw new Error('TI-86 native numeric token is invalid');
      }
      this.#offset += 1;
      return;
    }
    if (token === TOKEN.pi) {
      this.#offset += 1;
      return;
    }
    if (token === TOKEN.variable) {
      this.#offset += 1;
      this.#need(2, 'x variable');
      const length = this.#bytes[this.#offset++];
      const name = String.fromCharCode(this.#bytes[this.#offset++]);
      if (length !== 1 || name !== 'x' || !this.#allowedVariables.has('x')) {
        throw new Error("TI-86 native expression token variable 'x' is not allowed or canonical");
      }
      return;
    }
    if (token >= TOKEN.variable + 1 && token <= TOKEN.variable + 8) {
      const length = token - TOKEN.variable;
      this.#offset += 1;
      this.#need(length, 'named variable');
      const nameBytes = this.#bytes.subarray(this.#offset, this.#offset + length);
      this.#offset += length;
      if (nameBytes.some((byte) => byte > 0x7F)) throw new Error('TI-86 native named variable is not ASCII');
      const name = nameBytes.toString('ascii');
      if (!/^[A-Z][A-Z0-9]{0,7}$/.test(name) || !this.#allowedVariables.has(name)) {
        throw new Error(`TI-86 native expression token variable '${name}' is not allowed or canonical`);
      }
      return;
    }
    if (Object.values(FUNCTION_TOKEN).includes(token)) {
      this.#offset += 1;
      this.#expect(TOKEN.leftParen, 'function left parenthesis');
      this.#additive(depth + 1);
      this.#expect(TOKEN.rightParen, 'function right parenthesis');
      return;
    }
    if (token === TOKEN.leftParen) {
      this.#offset += 1;
      this.#additive(depth + 1);
      this.#expect(TOKEN.rightParen, 'right parenthesis');
      return;
    }
    throw new Error(`TI-86 native expression tokens contain unsupported byte 0x${token.toString(16)}`);
  }

  #expect(token, label) {
    if (this.#peek() !== token) throw new Error(`TI-86 native expression tokens expected ${label}`);
    this.#offset += 1;
  }

  #peek() { return this.#bytes[this.#offset]; }

  #need(length, label) {
    if (this.#offset + length > this.#bytes.length) {
      throw new Error(`TI-86 native expression tokens are truncated at ${label}`);
    }
  }

  #bounded(depth) {
    if (depth > TI86_NATIVE_MAX_EXPRESSION_DEPTH) {
      throw new Error(`TI-86 native expression exceeds nesting depth ${TI86_NATIVE_MAX_EXPRESSION_DEPTH}`);
    }
  }
}

function mapCalculator(config) {
  const expression = config.expression === undefined
    ? Buffer.alloc(0)
    : tokenizeTi86NativeExpression(config.expression);
  return {
    launch: TI86_NATIVE_LAUNCH.home,
    snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.homeEntry],
    payload: byteStrings([expression], 'calculator expression'),
  };
}

function mapGraph(config) {
  if (!Array.isArray(config.equations) || config.equations.length < 1
      || config.equations.length > TI86_NATIVE_MAX_EQUATIONS) {
    throw new Error(`graph@1 requires 1..${TI86_NATIVE_MAX_EQUATIONS} equations`);
  }
  const seen = new Set();
  const body = [config.equations.length];
  config.equations.forEach((raw, index) => {
    const equation = plainObject(raw, `graph@1 equations[${index}]`);
    assertExactKeys(equation, ['slot', 'expression'], `graph@1 equations[${index}]`);
    const slot = LOGICAL_EQUATION_SLOT[equation.slot];
    if (!slot) throw new Error(`graph@1 logical equation slot at equations[${index}].slot must be primary, secondary, tertiary, or quaternary`);
    if (seen.has(slot)) throw new Error(`graph@1 repeats logical equation slot '${equation.slot}'`);
    seen.add(slot);
    const tokens = tokenizeTi86NativeExpression(equation.expression);
    body.push(slot, tokens.length, ...tokens);
  });
  const window = config.window === undefined ? null : mapWindow(config.window);
  body.push(window?.mask ?? 0, ...(window?.bytes ?? []));
  return {
    launch: TI86_NATIVE_LAUNCH.graph,
    snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase],
    payload: Buffer.from(body),
  };
}

function mapTable(config) {
  if (!Array.isArray(config.expressions) || config.expressions.length < 1
      || config.expressions.length > TI86_NATIVE_MAX_EQUATIONS) {
    throw new Error(`table@1 requires 1..${TI86_NATIVE_MAX_EQUATIONS} expressions`);
  }
  const expressions = config.expressions.map((expression) => tokenizeTi86NativeExpression(expression));
  const start = encodeTi86Real(config.start ?? 0);
  const step = encodeTi86Real(config.step ?? 1);
  if (decodeTi86Real(step) === 0) throw new Error('table@1 step must be non-zero');
  return {
    launch: TI86_NATIVE_LAUNCH.table,
    snapshot: [
      TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase,
      TI86_NATIVE_SNAPSHOT_RESOURCE.tableSettings,
    ],
    payload: Buffer.concat([byteStrings(expressions, 'table expression'), start, step]),
  };
}

function mapSolver(config) {
  const variable = normalizeVariableName(config.variable);
  const equation = tokenizeTi86NativeExpression(config.equation, {
    variables: [variable],
    allowEquation: true,
  });
  const initial = config.initial === undefined ? null : encodeTi86Real(config.initial);
  return {
    launch: TI86_NATIVE_LAUNCH.solver,
    snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.solverState],
    payload: Buffer.concat([
      byteStrings([equation], 'solver equation'),
      Buffer.from([variable.length]), Buffer.from(variable, 'ascii'),
      Buffer.from([initial ? 1 : 0]), ...(initial ? [initial] : []),
    ]),
  };
}

function mapMatrix(config) {
  if (!Array.isArray(config.matrices) || config.matrices.length < 1 || config.matrices.length > 3) {
    throw new Error('matrix@1 requires 1..3 matrices');
  }
  const body = [config.matrices.length];
  config.matrices.forEach((raw, index) => {
    const matrix = plainObject(raw, `matrix@1 matrices[${index}]`);
    assertExactKeys(matrix, ['id', 'values'], `matrix@1 matrices[${index}]`);
    if (typeof matrix.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(matrix.id)) {
      throw new Error(`matrix@1 matrices[${index}].id must be a logical identifier`);
    }
    if (!Array.isArray(matrix.values) || matrix.values.length < 1 || matrix.values.length > 6) {
      throw new Error(`matrix@1 matrices[${index}] must have 1..6 rows`);
    }
    const columns = Array.isArray(matrix.values[0]) ? matrix.values[0].length : 0;
    if (columns < 1 || columns > 6 || !matrix.values.every((row) => (
      Array.isArray(row) && row.length === columns
    ))) throw new Error(`matrix@1 matrices[${index}] must be rectangular with 1..6 columns`);
    body.push(index + 1, matrix.values.length, columns);
    matrix.values.flat().forEach((value, cell) => {
      try { body.push(...encodeTi86Real(value)); }
      catch (error) { throw new Error(`matrix@1 matrices[${index}] cell ${cell}: ${error.message}`); }
    });
  });
  return {
    launch: TI86_NATIVE_LAUNCH.matrixEditor,
    snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.matrixWorkspace],
    payload: Buffer.from(body),
  };
}

function mapEquationEditor(config) {
  if (!Array.isArray(config.equations) || config.equations.length < 1
      || config.equations.length > TI86_NATIVE_MAX_EQUATIONS) {
    throw new Error(`equation-editor@1 requires 1..${TI86_NATIVE_MAX_EQUATIONS} equations`);
  }
  const equations = config.equations.map((expression) => tokenizeTi86NativeExpression(expression));
  return {
    launch: TI86_NATIVE_LAUNCH.equationEditor,
    snapshot: [TI86_NATIVE_SNAPSHOT_RESOURCE.functionGraphDatabase],
    payload: byteStrings(equations, 'equation-editor expression'),
  };
}

function mapNativeProgram(config, programs) {
  if (typeof config.toolId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.toolId)) {
    throw new Error('native-program@1 toolId must be a logical identifier');
  }
  const definition = programs.get(config.toolId);
  if (!definition) throw new Error(`native-program@1 toolId '${config.toolId}' is not allowlisted for TI-86`);
  const args = config.args ?? [];
  if (!Array.isArray(args) || args.length > definition.maxArgs || args.length > TI86_NATIVE_MAX_PROGRAM_ARGS) {
    throw new Error(`native-program@1 '${config.toolId}' exceeds its ${definition.maxArgs}-argument limit`);
  }
  if (definition.argumentKinds && args.length !== definition.argumentKinds.length) {
    throw new Error(`native-program@1 '${config.toolId}' requires ${definition.argumentKinds.length} arguments`);
  }
  const body = [definition.programName.length, ...Buffer.from(definition.programName, 'ascii'), args.length];
  args.forEach((value, index) => {
    const actual = scalarKind(value);
    const expected = definition.argumentKinds?.[index];
    if (!actual || (expected && actual !== expected)) {
      throw new Error(`native-program@1 '${config.toolId}' argument ${index} must be ${expected ?? 'a scalar'}`);
    }
    if (actual === 'number') body.push(1, ...encodeTi86Real(value));
    if (actual === 'string') {
      const bytes = Buffer.from(value, 'ascii');
      if (bytes.length > 32 || !/^[\x20-\x7E]*$/.test(value)) {
        throw new Error(`native-program@1 '${config.toolId}' argument ${index} must be at most 32 ASCII characters`);
      }
      body.push(2, bytes.length, ...bytes);
    }
    if (actual === 'boolean') body.push(3, value ? 1 : 0);
  });
  return {
    launch: TI86_NATIVE_LAUNCH.basicProgram,
    snapshot: definition.snapshot,
    payload: Buffer.from(body),
  };
}

function mapWindow(raw) {
  const window = plainObject(raw, 'graph@1 window');
  const fields = ['xMin', 'xMax', 'yMin', 'yMax'];
  assertExactKeys(window, fields, 'graph@1 window');
  fields.forEach((field) => {
    if (typeof window[field] !== 'number' || !Number.isFinite(window[field])) {
      throw new Error(`graph@1 window.${field} must be finite`);
    }
  });
  if (window.xMin >= window.xMax) throw new Error('graph@1 window.xMin must be less than xMax');
  if (window.yMin >= window.yMax) throw new Error('graph@1 window.yMin must be less than yMax');
  return {
    mask: 0x0F,
    bytes: fields.flatMap((field) => [...encodeTi86Real(window[field])]),
  };
}

function byteStrings(values, label) {
  const body = [values.length];
  values.forEach((value, index) => {
    const bytes = Buffer.from(value);
    if (bytes.length > 0xFF) throw new Error(`${label} ${index} exceeds 255 bytes`);
    body.push(bytes.length, ...bytes);
  });
  return Buffer.from(body);
}

function normalizeProgramAllowlist(programs) {
  if (!programs || typeof programs !== 'object' || Array.isArray(programs)) {
    throw new Error('TI-86 native program allowlist must be a mapping');
  }
  const normalized = new Map();
  const installedNames = new Set();
  for (const [toolId, raw] of Object.entries(programs)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(toolId)) throw new Error(`invalid TI-86 logical tool ID '${toolId}'`);
    const definition = plainObject(raw, `TI-86 native program '${toolId}'`);
    assertExactKeys(definition, ['programName', 'maxArgs', 'argumentKinds', 'snapshotResources'], `TI-86 native program '${toolId}'`);
    if (typeof definition.programName !== 'string' || !/^[A-Z][A-Z0-9]{0,7}$/.test(definition.programName)) {
      throw new Error(`TI-86 native program '${toolId}' has an invalid installed program name`);
    }
    if (installedNames.has(definition.programName)) {
      throw new Error(`TI-86 native program name '${definition.programName}' is allowlisted more than once`);
    }
    installedNames.add(definition.programName);
    const argumentKinds = definition.argumentKinds === undefined ? null : definition.argumentKinds;
    if (argumentKinds !== null && (!Array.isArray(argumentKinds)
        || argumentKinds.length > TI86_NATIVE_MAX_PROGRAM_ARGS
        || !argumentKinds.every((kind) => ['number', 'string', 'boolean'].includes(kind)))) {
      throw new Error(`TI-86 native program '${toolId}' has invalid argumentKinds`);
    }
    const maxArgs = definition.maxArgs ?? argumentKinds?.length ?? 0;
    if (!Number.isInteger(maxArgs) || maxArgs < 0 || maxArgs > TI86_NATIVE_MAX_PROGRAM_ARGS
        || (argumentKinds && maxArgs !== argumentKinds.length)) {
      throw new Error(`TI-86 native program '${toolId}' has an invalid maxArgs`);
    }
    const requested = definition.snapshotResources ?? [];
    if (!Array.isArray(requested) || !requested.every((name) => Object.hasOwn(TI86_NATIVE_SNAPSHOT_RESOURCE, name))) {
      throw new Error(`TI-86 native program '${toolId}' has an invalid snapshot resource`);
    }
    const snapshot = [...new Set([
      TI86_NATIVE_SNAPSHOT_RESOURCE.nativeProgramWorkspace,
      ...requested.map((name) => TI86_NATIVE_SNAPSHOT_RESOURCE[name]),
    ])].sort((a, b) => a - b);
    normalized.set(toolId, Object.freeze({
      programName: definition.programName,
      maxArgs,
      argumentKinds: argumentKinds ? Object.freeze([...argumentKinds]) : null,
      snapshot: Object.freeze(snapshot),
    }));
  }
  return normalized;
}

class Ti86ExpressionParser {
  #tokens;
  #index = 0;
  #allowedVariables;
  #allowEquation;

  constructor(source, { allowedVariables, allowEquation }) {
    this.#tokens = lexExpression(source);
    this.#allowedVariables = allowedVariables;
    this.#allowEquation = allowEquation;
  }

  parse() {
    const left = this.#additive();
    if (this.#peek('operator', '=')) {
      if (!this.#allowEquation) throw new Error("TI-86 native expression does not allow '='");
      this.#index += 1;
      const right = this.#additive();
      if (this.#peek('operator', '=')) throw new Error('TI-86 solver equation may contain only one equality');
      this.#done();
      return [...left, TOKEN.equals, ...right];
    }
    this.#done();
    return left;
  }

  #additive() {
    let bytes = this.#multiplicative();
    while (this.#peek('operator', '+') || this.#peek('operator', '-')) {
      const operator = this.#tokens[this.#index++].value;
      bytes = [...bytes, operator === '+' ? TOKEN.plus : TOKEN.minus, ...this.#multiplicative()];
    }
    return bytes;
  }

  #multiplicative() {
    let bytes = this.#power();
    while (this.#peek('operator', '*') || this.#peek('operator', '/')) {
      const operator = this.#tokens[this.#index++].value;
      bytes = [...bytes, operator === '*' ? TOKEN.multiply : TOKEN.divide, ...this.#power()];
    }
    return bytes;
  }

  #power() {
    const left = this.#unary();
    if (!this.#peek('operator', '^')) return left;
    this.#index += 1;
    return [...left, TOKEN.power, ...this.#power()];
  }

  #unary() {
    if (!this.#peek('operator', '-')) return this.#primary();
    this.#index += 1;
    return [TOKEN.negate, ...this.#unary()];
  }

  #primary() {
    const token = this.#tokens[this.#index];
    if (!token) throw new Error('TI-86 native expression ends unexpectedly');
    if (token.type === 'number') {
      this.#index += 1;
      return [TOKEN.literalNumber, ...Buffer.from(token.value, 'ascii'), 0];
    }
    if (token.type === 'identifier') {
      this.#index += 1;
      const name = token.value.toLowerCase();
      if (name === 'pi') return [TOKEN.pi];
      if (Object.hasOwn(FUNCTION_TOKEN, name)) {
        this.#expect('leftParen');
        const argument = this.#additive();
        this.#expect('rightParen');
        return [FUNCTION_TOKEN[name], TOKEN.leftParen, ...argument, TOKEN.rightParen];
      }
      const nativeName = this.#allowedVariables.get(name);
      if (!nativeName) throw new Error(`TI-86 native expression variable '${token.value}' is not allowed`);
      return encodeVariableToken(nativeName);
    }
    if (token.type === 'leftParen') {
      this.#index += 1;
      const inner = this.#additive();
      this.#expect('rightParen');
      return [TOKEN.leftParen, ...inner, TOKEN.rightParen];
    }
    throw new Error(`TI-86 native expression has unexpected '${token.value}'`);
  }

  #expect(type) {
    if (this.#tokens[this.#index]?.type !== type) throw new Error(`TI-86 native expression expected ${type}`);
    this.#index += 1;
  }

  #peek(type, value) {
    const token = this.#tokens[this.#index];
    return token?.type === type && (value === undefined || token.value === value);
  }

  #done() {
    const token = this.#tokens[this.#index];
    if (token) throw new Error(`TI-86 native expression has unexpected '${token.value}'`);
  }
}

function lexExpression(source) {
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (number) {
      if (number[0].length > 24 || !Number.isFinite(Number(number[0]))) {
        throw new Error('TI-86 native expression has an invalid numeric literal');
      }
      tokens.push({ type: 'number', value: number[0] });
      offset += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z][A-Za-z0-9]*/.exec(rest);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      offset += identifier[0].length;
      continue;
    }
    const character = rest[0];
    if ('+-*/^='.includes(character)) tokens.push({ type: 'operator', value: character });
    else if (character === '(') tokens.push({ type: 'leftParen', value: character });
    else if (character === ')') tokens.push({ type: 'rightParen', value: character });
    else throw new Error(`TI-86 native expression contains unsupported character '${character}'`);
    offset += 1;
  }
  return tokens;
}

function encodeVariableToken(name) {
  if (name === 'x') return [TOKEN.variable, 1, 0x78];
  const bytes = Buffer.from(name, 'ascii');
  return [0x32 + bytes.length, ...bytes];
}

function normalizeVariableName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(value)) {
    throw new Error('TI-86 native variable must be a 1..8 character identifier');
  }
  return value.toLowerCase() === 'x' ? 'x' : value.toUpperCase();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

function assertExactKeys(value, allowed, label) {
  const permitted = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !permitted.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported field '${unknown[0]}'`);
}

function scalarKind(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

export default Ti86NativeToolMapper;
