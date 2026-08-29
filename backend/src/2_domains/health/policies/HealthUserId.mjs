import { ValidationError } from '#domains/core/errors/index.mjs';

export const HEALTH_USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function assertValidHealthUserId(userId) {
  if (!userId || typeof userId !== 'string' || !HEALTH_USER_ID_PATTERN.test(userId)) {
    throw new ValidationError(
      `HealthArchiveScope: invalid userId — must match ${HEALTH_USER_ID_PATTERN}: ${String(userId)}`,
      { code: 'INVALID_USER_ID', field: 'userId', value: userId },
    );
  }
}
