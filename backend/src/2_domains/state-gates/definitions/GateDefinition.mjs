import { PERIOD_KINDS, SUBJECT_KINDS, deepFreeze, fail, requireNamespacedId, requirePositiveInteger } from '../support.mjs';

export class GateDefinition {
  constructor({ id, schemaVersion, subjectKinds, periodKinds, expression, progress = null, reasonLabels = {} }) {
    this.id = requireNamespacedId(id, 'gate.id');
    this.schemaVersion = requirePositiveInteger(schemaVersion, 'gate.schemaVersion');
    this.subjectKinds = deepFreeze([...new Set(subjectKinds ?? [])]);
    this.periodKinds = deepFreeze([...new Set(periodKinds ?? [])]);
    if (!this.subjectKinds.length || this.subjectKinds.some(kind => !SUBJECT_KINDS.includes(kind))) {
      fail('Gate subject kinds are invalid', 'INVALID_SUBJECT_KINDS', 'subjectKinds');
    }
    if (!this.periodKinds.length || this.periodKinds.some(kind => !PERIOD_KINDS.includes(kind))) {
      fail('Gate period kinds are invalid', 'INVALID_PERIOD_KINDS', 'periodKinds');
    }
    if (!expression || typeof expression !== 'object') fail('Gate expression is required', 'EXPRESSION_REQUIRED', 'expression');
    this.expression = deepFreeze(expression);
    this.progress = progress ? deepFreeze({ ...progress }) : null;
    this.reasonLabels = deepFreeze({ ...reasonLabels });
    deepFreeze(this);
  }
}

export default GateDefinition;
