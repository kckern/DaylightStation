import { isDeepStrictEqual } from 'node:util';

/** Add-only importer: trust exact durable records; validate every changed/new record. */
export function preserveExistingEnrollments(validators, existingPrograms) {
  const result = new Map(validators);
  const programId = id => id === 'language' ? 'sentence-ladder' : id;
  for (const id of new Set(existingPrograms.map(row => programId(row.programId)))) {
    const validate = validators.get(id);
    result.set(id, async raw => {
      const existing = existingPrograms.find(row => isDeepStrictEqual({ ...row, programId: programId(row.programId) }, raw));
      if (existing) return { errors: [], enrollment: structuredClone(existing) };
      return validate ? validate(raw) : { errors: [`The importer cannot change or add program '${id}'.`] };
    });
  }
  return result;
}
