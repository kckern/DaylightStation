import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from '#apps/common/errors/SemanticErrors.mjs';

export class YamlConfigFileService {
  constructor({ configStore, logger = console }) {
    if (!configStore) throw new Error('YamlConfigFileService requires a configStore dependency');
    this.configStore = configStore;
    this.logger = logger;
  }

  #throwAddress(result, operation) {
    if (result.kind === 'path_required') {
      throw new ValidationError('File path is required', { code: 'PATH_REQUIRED' });
    }
    if (result.kind === 'not_yaml') {
      throw new ValidationError(`Only YAML files (.yml, .yaml) can be ${operation === 'write' ? 'written' : 'read'}`, { code: 'NOT_YAML' });
    }
    const authorization = {
      path_traversal: ['Access denied: path outside data root', 'PATH_TRAVERSAL', 'path traversal'],
      masked: ['Access denied: file is in a protected directory', 'MASKED', 'masked'],
      not_allowed: ['Access denied: file is not in an allowed directory', 'NOT_ALLOWED', 'not allowed'],
    }[result.kind];
    if (authorization) {
      this.logger.error?.(`admin.config.file.${operation}.blocked`, { path: result.path, reason: authorization[2] });
      throw new AuthorizationError(authorization[0], { code: authorization[1] });
    }
  }

  listFiles() {
    const files = this.configStore.listEditableDocuments();
    this.logger.info?.('admin.config.files.listed', { count: files.length });
    return { files, count: files.length };
  }

  readFile(rawPath) {
    const result = this.configStore.readEditableDocument(rawPath);
    this.#throwAddress(result, 'read');
    if (result.kind === 'missing') {
      throw new NotFoundError('File not found', undefined, { path: result.path, code: 'NOT_FOUND' });
    }
    if (result.parseError) {
      this.logger.info?.('admin.config.file.read.parse_warning', { path: result.path, error: result.parseError.message });
    }
    const { kind: _kind, parseError: _parseError, ...record } = result;
    this.logger.info?.('admin.config.file.read', { path: record.path, size: record.size });
    return record;
  }

  writeFile(rawPath, content = {}) {
    const result = this.configStore.writeEditableDocument(rawPath, content);
    this.#throwAddress(result, 'write');
    if (result.kind === 'empty') {
      throw new ValidationError('Request body must include either "raw" (YAML string) or "parsed" (object)', { code: 'EMPTY_BODY' });
    }
    if (result.kind === 'invalid_yaml') {
      throw new ValidationError('Invalid YAML syntax', {
        code: 'INVALID_YAML',
        details: { message: result.error.message, line: result.error.mark?.line, column: result.error.mark?.column },
      });
    }
    if (result.kind === 'dump_failed') {
      throw new ValidationError('Failed to serialize object to YAML', {
        code: 'YAML_DUMP_FAILED', details: { message: result.error.message },
      });
    }
    const { kind: _kind, ...receipt } = result;
    this.logger.info?.('admin.config.file.written', { path: receipt.path, size: receipt.size });
    return { ok: true, ...receipt };
  }
}

export default YamlConfigFileService;
