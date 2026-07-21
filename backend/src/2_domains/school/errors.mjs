/** Guest session attempted against an audience:assigned bank → HTTP 403. */
export class GuestForbiddenError extends Error {}
/** Unknown or expired sessionId → HTTP 410. */
export class SessionGoneError extends Error {}
