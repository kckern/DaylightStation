import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { parseCapabilityId } from '#domains/school/catalog/index.mjs';

/**
 * Registry for code-backed module schemas. Definitions describe portable
 * configuration; calculator adapters separately advertise renderer support.
 */
export class LearningModuleRegistry {
  #definitions;

  constructor({ definitions = [] } = {}) {
    this.#definitions = new Map();
    definitions.forEach((definition) => this.register(definition));
  }

  register({ capability, kind, validateConfig, interaction = null }) {
    if (!parseCapabilityId(capability)) throw new Error(`Invalid learning module capability '${capability}'`);
    if (!['tool', 'custom'].includes(kind)) throw new Error(`Learning module '${capability}' has invalid kind`);
    if (typeof validateConfig !== 'function') throw new Error(`Learning module '${capability}' requires validateConfig`);
    const normalizedInteraction = kind === 'custom'
      ? normalizeCustomInteraction(interaction, capability)
      : null;
    if (this.#definitions.has(capability)) {
      throw new DomainInvariantError(`Duplicate learning module definition '${capability}'`, {
        code: 'DUPLICATE_LEARNING_MODULE_DEFINITION',
      });
    }
    this.#definitions.set(capability, Object.freeze({
      capability, kind, validateConfig,
      ...(normalizedInteraction ? { interaction: normalizedInteraction } : {}),
    }));
    return this;
  }

  validate(module) {
    if (!module || !['tool', 'custom'].includes(module.type)) return { errors: [] };
    const definition = this.#definitions.get(module.capability);
    if (!definition || definition.kind !== module.type) {
      return { errors: [`unregistered ${module.type} capability '${module.capability}'`] };
    }
    const errors = definition.validateConfig(structuredClone(module.config));
    if (!Array.isArray(errors) || !errors.every((entry) => typeof entry === 'string')) {
      throw new Error(`Learning module validator '${module.capability}' must return string[]`);
    }
    return { errors: errors.map((error) => `${module.capability}: ${error}`), definition };
  }

  list() {
    return [...this.#definitions.values()].map(({ capability, kind, interaction }) => ({
      capability, kind,
      ...(interaction ? { interaction: structuredClone(interaction) } : {}),
    }));
  }
}

export function createCoreLearningModuleRegistry({ customDefinitions = [] } = {}) {
  return new LearningModuleRegistry({ definitions: [...nativeToolDefinitions(), ...customDefinitions] });
}

function nativeToolDefinitions() {
  return [
    tool('calculator@1', validateCalculator),
    tool('graph@1', validateGraph),
    tool('table@1', validateTable),
    tool('solver@1', validateSolver),
    tool('matrix@1', validateMatrix),
    tool('equation-editor@1', validateEquationEditor),
    tool('native-program@1', validateNativeProgram),
  ];
}

function tool(capability, validateConfig) { return { capability, kind: 'tool', validateConfig }; }
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const OVERVIEW_TOPOLOGIES = Object.freeze(['grid', 'ordered', 'spatial', 'relational']);
const POSITION_MEMORY = Object.freeze(['session', 'stable_item']);
const OVERVIEW_FALLBACKS = Object.freeze(['list', 'incompatible']);
const LEGEND_PLACEMENTS = Object.freeze(['inline', 'info', 'none']);

/**
 * v0 custom code uses one portable interaction grammar. A capability-specific
 * renderer owns geometry, while School surfaces can still reason about focus,
 * inspection, fallback, and continuation without learning the subject.
 */
function normalizeCustomInteraction(raw, capability) {
  if (!isObject(raw)) {
    throw new Error(`Learning custom module '${capability}' requires an interaction contract`);
  }
  const expected = {
    model: 'overview_detail',
    navigation: 'snap',
    inspector: 'stable',
    focusIdentity: 'item_id',
  };
  for (const [field, value] of Object.entries(expected)) {
    if (raw[field] !== value) {
      throw new Error(`Learning custom module '${capability}' interaction.${field} must be '${value}'`);
    }
  }
  if (!OVERVIEW_TOPOLOGIES.includes(raw.topology)) {
    throw new Error(`Learning custom module '${capability}' interaction.topology must be ${OVERVIEW_TOPOLOGIES.join('|')}`);
  }
  if (!POSITION_MEMORY.includes(raw.positionMemory)) {
    throw new Error(`Learning custom module '${capability}' interaction.positionMemory must be ${POSITION_MEMORY.join('|')}`);
  }
  if (!OVERVIEW_FALLBACKS.includes(raw.fallback)) {
    throw new Error(`Learning custom module '${capability}' interaction.fallback must be ${OVERVIEW_FALLBACKS.join('|')}`);
  }
  if (!LEGEND_PLACEMENTS.includes(raw.legend)) {
    throw new Error(`Learning custom module '${capability}' interaction.legend must be ${LEGEND_PLACEMENTS.join('|')}`);
  }
  return Object.freeze({
    model: 'overview_detail', topology: raw.topology, navigation: 'snap',
    inspector: 'stable', focusIdentity: 'item_id',
    positionMemory: raw.positionMemory, fallback: raw.fallback, legend: raw.legend,
  });
}

function validateCalculator(config) {
  const errors = [];
  if (config.expression !== undefined && !isText(config.expression)) errors.push('expression must be non-empty when present');
  rejectExecutableFields(config, errors);
  return errors;
}

function validateGraph(config) {
  const errors = [];
  if (!Array.isArray(config.equations) || config.equations.length === 0) {
    errors.push('equations must be a non-empty array');
  } else {
    const slots = new Set();
    config.equations.forEach((equation, index) => {
      if (!isObject(equation)) { errors.push(`equations[${index}] must be a mapping`); return; }
      if (!isText(equation.slot)) errors.push(`equations[${index}].slot is required`);
      else if (slots.has(equation.slot)) errors.push(`equations[${index}].slot duplicates '${equation.slot}'`);
      else slots.add(equation.slot);
      if (!isText(equation.expression)) errors.push(`equations[${index}].expression is required`);
    });
  }
  if (config.window !== undefined) validateWindow(config.window, errors);
  rejectExecutableFields(config, errors);
  return errors;
}

function validateTable(config) {
  const errors = [];
  if (!Array.isArray(config.expressions) || config.expressions.length === 0 || !config.expressions.every(isText)) {
    errors.push('expressions must be a non-empty array of strings');
  }
  if (config.start !== undefined && !isFiniteNumber(config.start)) errors.push('start must be finite when present');
  if (config.step !== undefined && (!isFiniteNumber(config.step) || config.step === 0)) errors.push('step must be finite and non-zero when present');
  rejectExecutableFields(config, errors);
  return errors;
}

function validateSolver(config) {
  const errors = [];
  if (!isText(config.equation)) errors.push('equation is required');
  if (!isText(config.variable)) errors.push('variable is required');
  if (config.initial !== undefined && !isFiniteNumber(config.initial)) errors.push('initial must be finite when present');
  rejectExecutableFields(config, errors);
  return errors;
}

function validateMatrix(config) {
  const errors = [];
  if (!Array.isArray(config.matrices) || config.matrices.length === 0) {
    errors.push('matrices must be a non-empty array');
  } else {
    config.matrices.forEach((matrix, index) => {
      if (!isObject(matrix) || !isText(matrix.id) || !Array.isArray(matrix.values) || matrix.values.length === 0) {
        errors.push(`matrices[${index}] must contain id and non-empty values`);
        return;
      }
      const width = Array.isArray(matrix.values[0]) ? matrix.values[0].length : 0;
      if (width === 0 || !matrix.values.every((row) => Array.isArray(row) && row.length === width && row.every(isFiniteNumber))) {
        errors.push(`matrices[${index}].values must be a rectangular finite-number matrix`);
      }
    });
  }
  rejectExecutableFields(config, errors);
  return errors;
}

function validateEquationEditor(config) {
  const errors = [];
  if (!Array.isArray(config.equations) || config.equations.length === 0 || !config.equations.every(isText)) {
    errors.push('equations must be a non-empty array of strings');
  }
  rejectExecutableFields(config, errors);
  return errors;
}

function validateNativeProgram(config) {
  const errors = [];
  if (!isText(config.toolId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.toolId || '')) {
    errors.push('toolId must be a lowercase logical identifier');
  }
  if (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every((value) => (
    typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)
  )))) errors.push('args must contain only scalar values when present');
  rejectExecutableFields(config, errors);
  return errors;
}

function validateWindow(window, errors) {
  if (!isObject(window)) { errors.push('window must be a mapping'); return; }
  for (const field of ['xMin', 'xMax', 'yMin', 'yMax']) {
    if (!isFiniteNumber(window[field])) errors.push(`window.${field} must be finite`);
  }
  if (isFiniteNumber(window.xMin) && isFiniteNumber(window.xMax) && window.xMin >= window.xMax) errors.push('window.xMin must be less than xMax');
  if (isFiniteNumber(window.yMin) && isFiniteNumber(window.yMax) && window.yMin >= window.yMax) errors.push('window.yMin must be less than yMax');
}

function rejectExecutableFields(config, errors) {
  for (const field of ['source', 'code', 'assembly', 'basic', 'programName']) {
    if (Object.hasOwn(config, field)) errors.push(`${field} is forbidden; content selects reviewed logical tools only`);
  }
}

export default LearningModuleRegistry;
