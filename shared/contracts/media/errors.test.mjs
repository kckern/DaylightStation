import { describe, it, expect } from 'vitest';
import { ERROR_CODES, buildErrorBody } from './errors.mjs';

describe('ERROR_CODES', () => {
  it('is a frozen object', () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });

  it('defines CONTENT_NOT_FOUND', () => {
    expect(ERROR_CODES.CONTENT_NOT_FOUND).toBe('CONTENT_NOT_FOUND');
  });

  it('defines SEARCH_TEXT_TOO_SHORT', () => {
    expect(ERROR_CODES.SEARCH_TEXT_TOO_SHORT).toBe('SEARCH_TEXT_TOO_SHORT');
  });

  it('defines DEVICE_NOT_FOUND', () => {
    expect(ERROR_CODES.DEVICE_NOT_FOUND).toBe('DEVICE_NOT_FOUND');
  });

  it('defines DEVICE_OFFLINE', () => {
    expect(ERROR_CODES.DEVICE_OFFLINE).toBe('DEVICE_OFFLINE');
  });

  it('defines DEVICE_REFUSED', () => {
    expect(ERROR_CODES.DEVICE_REFUSED).toBe('DEVICE_REFUSED');
  });

  it('defines DEVICE_BUSY', () => {
    expect(ERROR_CODES.DEVICE_BUSY).toBe('DEVICE_BUSY');
  });

  it('defines WAKE_FAILED', () => {
    expect(ERROR_CODES.WAKE_FAILED).toBe('WAKE_FAILED');
  });

  it('defines ATOMICITY_VIOLATION', () => {
    expect(ERROR_CODES.ATOMICITY_VIOLATION).toBe('ATOMICITY_VIOLATION');
  });

  it('defines IDEMPOTENCY_CONFLICT', () => {
    expect(ERROR_CODES.IDEMPOTENCY_CONFLICT).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('buildErrorBody', () => {
  it('returns minimal body with just error', () => {
    expect(buildErrorBody({ error: 'boom' })).toEqual({ ok: false, error: 'boom' });
  });

  it('includes code when provided', () => {
    expect(buildErrorBody({ error: 'boom', code: 'DEVICE_OFFLINE' })).toEqual({
      ok: false,
      error: 'boom',
      code: 'DEVICE_OFFLINE',
    });
  });

  it('omits details when array is empty', () => {
    const body = buildErrorBody({ error: 'boom', details: [] });
    expect(body).toEqual({ ok: false, error: 'boom' });
    expect('details' in body).toBe(false);
  });

  it('includes details when array is non-empty', () => {
    expect(buildErrorBody({ error: 'boom', details: ['x'] })).toEqual({
      ok: false,
      error: 'boom',
      details: ['x'],
    });
  });

  it('includes retryable: true when provided', () => {
    expect(buildErrorBody({ error: 'boom', retryable: true })).toEqual({
      ok: false,
      error: 'boom',
      retryable: true,
    });
  });

  it('includes retryable: false when provided', () => {
    expect(buildErrorBody({ error: 'boom', retryable: false })).toEqual({
      ok: false,
      error: 'boom',
      retryable: false,
    });
  });

  it('defaults error to "Unknown error" when no args', () => {
    expect(buildErrorBody({})).toEqual({ ok: false, error: 'Unknown error' });
  });

  it('coerces non-string error to string', () => {
    expect(buildErrorBody({ error: 1 })).toEqual({ ok: false, error: '1' });
  });
});
