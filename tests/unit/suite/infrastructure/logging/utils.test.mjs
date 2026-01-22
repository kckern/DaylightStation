// tests/unit/infrastructure/logging/utils.test.mjs
import { serializeError, extractHttpErrorDetails } from '#backend/src/0_infrastructure/logging/utils.js';

describe('serializeError', () => {
  test('returns null for null input', () => {
    expect(serializeError(null)).toBeNull();
    expect(serializeError(undefined)).toBeNull();
  });

  test('serializes standard Error', () => {
    const error = new Error('Test error');
    error.code = 'ERR_TEST';

    const result = serializeError(error);

    expect(result.name).toBe('Error');
    expect(result.message).toBe('Test error');
    expect(result.stack).toBeDefined();
    expect(result.code).toBe('ERR_TEST');
  });

  test('serializes TypeError', () => {
    const error = new TypeError('Cannot read property');
    const result = serializeError(error);

    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('Cannot read property');
  });

  test('includes statusCode if present', () => {
    const error = new Error('HTTP error');
    error.statusCode = 404;

    const result = serializeError(error);
    expect(result.statusCode).toBe(404);
  });

  test('includes errno and syscall for system errors', () => {
    const error = new Error('ENOENT');
    error.errno = -2;
    error.syscall = 'open';

    const result = serializeError(error);
    expect(result.errno).toBe(-2);
    expect(result.syscall).toBe('open');
  });

  test('serializes error-like object', () => {
    const errorLike = {
      name: 'CustomError',
      message: 'Something went wrong',
      code: 'CUSTOM_ERR'
    };

    const result = serializeError(errorLike);
    expect(result.name).toBe('CustomError');
    expect(result.message).toBe('Something went wrong');
    expect(result.code).toBe('CUSTOM_ERR');
  });

  test('serializes object with shortMessage', () => {
    const errorLike = { shortMessage: 'Brief error' };
    const result = serializeError(errorLike);
    expect(result.message).toBe('Brief error');
  });

  test('serializes primitive string', () => {
    const result = serializeError('Simple error message');
    expect(result.message).toBe('Simple error message');
  });

  test('serializes primitive number', () => {
    const result = serializeError(500);
    expect(result.message).toBe('500');
  });
});

describe('extractHttpErrorDetails', () => {
  test('extracts axios error details', () => {
    const axiosError = new Error('Request failed');
    axiosError.config = {
      url: 'https://api.example.com/users',
      method: 'GET'
    };
    axiosError.response = {
      status: 404,
      statusText: 'Not Found',
      data: { error: 'User not found' }
    };

    const result = extractHttpErrorDetails(axiosError);

    expect(result.message).toBe('Request failed');
    expect(result.url).toBe('https://api.example.com/users');
    expect(result.method).toBe('GET');
    expect(result.statusCode).toBe(404);
    expect(result.statusText).toBe('Not Found');
    expect(result.responseData).toEqual({ error: 'User not found' });
  });

  test('handles error without response', () => {
    const error = new Error('Network error');

    const result = extractHttpErrorDetails(error);

    expect(result.message).toBe('Network error');
    expect(result.url).toBeNull();
    expect(result.statusCode).toBeNull();
  });

  test('extracts url from request if config missing', () => {
    const error = new Error('Request error');
    error.request = {
      url: 'https://api.example.com/data',
      method: 'POST'
    };

    const result = extractHttpErrorDetails(error);
    expect(result.url).toBe('https://api.example.com/data');
    expect(result.method).toBe('POST');
  });
});
