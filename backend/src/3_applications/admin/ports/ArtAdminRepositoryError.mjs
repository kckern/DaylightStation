export const ArtAdminRepositoryErrorCode = Object.freeze({
  INVALID_SOURCE: 'ART_ADMIN_INVALID_SOURCE',
  INVALID_WORK_ID: 'ART_ADMIN_INVALID_WORK_ID',
  WORK_NOT_FOUND: 'ART_ADMIN_WORK_NOT_FOUND',
});

export class ArtAdminRepositoryError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'ArtAdminRepositoryError';
    this.code = code;
  }
}
