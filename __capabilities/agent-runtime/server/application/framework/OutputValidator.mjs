import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export class OutputValidator {
  static validate(output, schema) {
    let parsed;
    try {
      parsed = typeof output === 'string' ? JSON.parse(output) : output;
    } catch (e) {
      return {
        valid: false,
        data: null,
        errors: [{ message: 'Output is not valid JSON', raw: output }],
      };
    }

    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    return {
      valid,
      data: valid ? parsed : null,
      errors: valid ? [] : validate.errors,
    };
  }

  static async validateWithRetry(output, schema, { agentRuntime, systemPrompt, tools, maxRetries = 2, logger }) {
    let result = OutputValidator.validate(output, schema);
    let attempts = 0;

    while (!result.valid && attempts < maxRetries) {
      attempts++;
      logger?.warn?.('output.validation.retry', { attempt: attempts, errors: result.errors });

      const correctionPrompt =
        `Your previous output failed validation.\n\n` +
        `## Errors\n${JSON.stringify(result.errors, null, 2)}\n\n` +
        `## Your Previous Output\n${JSON.stringify(output)}\n\n` +
        `Fix the errors and return valid output.`;

      const retryResult = await agentRuntime.execute({
        input: correctionPrompt,
        tools,
        systemPrompt,
      });

      output = retryResult.output;
      result = OutputValidator.validate(output, schema);
    }

    return result;
  }
}
