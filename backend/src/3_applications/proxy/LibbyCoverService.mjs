/**
 * Open loan artwork through an injected cover gateway.
 * The structural port openCover({ cardId, titleId, signal }) returns only
 * { body: ReadableStream, contentType, contentLength, cleanup }.
 */
export class LibbyCoverService {
  constructor({ coverGateway } = {}) {
    if (typeof coverGateway?.openCover !== 'function') throw new Error('LibbyCoverService requires coverGateway');
    this.coverGateway = coverGateway;
  }

  async open(input) {
    try {
      const { body, contentType, contentLength, cleanup } = await this.coverGateway.openCover(input);
      return { kind: 'opened', body, contentType, contentLength, cleanup };
    } catch (error) {
      if (['LIBBY_LOAN_NOT_FOUND', 'LIBBY_LOAN_EXPIRED'].includes(error?.code)) return { kind: 'gone' };
      if (error?.code === 'LIBBY_CREDENTIAL_UNAVAILABLE') return { kind: 'credential_unavailable' };
      return { kind: 'upstream_error' };
    }
  }
}
