import { retryTransient } from '#backend/src/0_system/utils/retryTransient.mjs';

describe('retryTransient', () => {
  it('should return result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryTransient(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient error and succeed', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('recovered');

    const result = await retryTransient(fn, { maxAttempts: 3, baseDelay: 0 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on non-transient error', async () => {
    const permanentError = new Error('bad request');
    permanentError.isTransient = false;
    const fn = jest.fn().mockRejectedValue(permanentError);

    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 0 }))
      .rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw after exhausting all attempts', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn().mockRejectedValue(transientError);

    await expect(retryTransient(fn, { maxAttempts: 3, baseDelay: 0 }))
      .rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry callback between attempts', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue('ok');

    await retryTransient(fn, { maxAttempts: 3, baseDelay: 0, onRetry });
    expect(onRetry).toHaveBeenCalledWith(1, transientError);
  });

  it('should default to 3 attempts and 1000ms base delay', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const fn = jest.fn().mockRejectedValue(transientError);

    const start = Date.now();
    await expect(retryTransient(fn, { baseDelay: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should treat errors without isTransient as non-retryable', async () => {
    const ambiguousError = new Error('unknown');
    const fn = jest.fn().mockRejectedValue(ambiguousError);

    await expect(retryTransient(fn, { baseDelay: 0 })).rejects.toThrow('unknown');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not retry when maxAttempts is 1', async () => {
    const transientError = new Error('timeout');
    transientError.isTransient = true;
    const onRetry = jest.fn();
    const fn = jest.fn().mockRejectedValue(transientError);

    await expect(retryTransient(fn, { maxAttempts: 1, baseDelay: 0, onRetry }))
      .rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
