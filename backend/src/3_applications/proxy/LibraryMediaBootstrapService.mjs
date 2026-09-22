import { normalizeBootstrapSpine, validBootstrapInput } from './ports/ILibraryMediaBootstrapGateway.mjs';

/** Map the bootstrap port into categorical outcomes without exposing external failure details. */
export class LibraryMediaBootstrapService {
  constructor({ bootstrapGateway } = {}) {
    if (typeof bootstrapGateway?.bootstrapLoan !== 'function') throw new Error('LibraryMediaBootstrapService requires bootstrapGateway');
    this.bootstrapGateway = bootstrapGateway;
  }

  async open(input, { signal } = {}) {
    if (!validBootstrapInput(input)) return { kind: 'invalid_request' };
    try {
      const spine = normalizeBootstrapSpine(await this.bootstrapGateway.bootstrapLoan(input, { signal }));
      return Object.freeze({ kind: 'opened', ...spine });
    } catch (error) {
      const kinds = { BOOTSTRAP_TIMEOUT: 'timeout', BOOTSTRAP_BUSY: 'busy', BOOTSTRAP_ABORTED: 'aborted',
        BOOTSTRAP_UNSUPPORTED: 'unsupported', BOOTSTRAP_INVALID_REQUEST: 'invalid_request' };
      return { kind: Object.hasOwn(kinds, error?.code) ? kinds[error.code] : 'upstream_error' };
    }
  }
}
