import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, logger: false, addUsedSchema: false });

/** Lossless JSON Schema / Standard Schema bridge. Never weaken tool contracts. */
export function standardSchema(schema = { type: 'object', properties: {} }) {
  const json = structuredClone(schema);
  const validate = ajv.compile(json);
  return {
    '~standard': {
      version: 1,
      vendor: 'daylight',
      jsonSchema: { input: () => structuredClone(json), output: () => structuredClone(json) },
      validate(value) {
        if (validate(value)) return { value };
        return { issues: validate.errors.map(error => ({
          message: `${error.instancePath || '/'} ${error.message}`,
        })) };
      },
    },
  };
}

export function assertSchema(value, schema, label = 'value') {
  if (!schema) return value;
  const result = standardSchema(schema)['~standard'].validate(value);
  if (result.issues) {
    const error = new Error(`Invalid ${label}: ${result.issues.map(i => i.message).join('; ')}`);
    error.code = 'AGENT_SCHEMA_INVALID';
    throw error;
  }
  return value;
}
