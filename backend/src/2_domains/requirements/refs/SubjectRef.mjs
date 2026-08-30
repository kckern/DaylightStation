import { SUBJECT_KINDS, deepFreeze, fail, requireNonEmpty } from '../support.mjs';

export class SubjectRef {
  constructor({ kind, id }) {
    if (!SUBJECT_KINDS.includes(kind)) fail('Unsupported subject kind', 'UNSUPPORTED_SUBJECT_KIND', 'kind', { kind });
    this.kind = kind;
    this.id = requireNonEmpty(id, 'subject.id', 'INVALID_SUBJECT_ID');
    deepFreeze(this);
  }

  equals(other) { return this.kind === other?.kind && this.id === other?.id; }
}

export default SubjectRef;
