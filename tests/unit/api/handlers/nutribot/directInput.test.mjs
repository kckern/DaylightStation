// tests/unit/api/handlers/nutribot/directInput.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { directUPCHandler } from '../../../../../backend/src/4_api/v1/handlers/nutribot/directInput.mjs';

describe('directUPCHandler', () => {
  let executeMock;
  let nutribotApi;
  let handler;

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    executeMock = jest.fn().mockResolvedValue({ success: true });
    nutribotApi = {
      userContext: jest.fn().mockReturnValue({ userId: 'user_1', conversationId: 'telegram:1_2' }),
      logUpc: executeMock,
    };
    handler = directUPCHandler(nutribotApi, {
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  it('answers a refused barcode with 400 and the reason', async () => {
    const refusal = Object.assign(new Error("That isn't a food barcode (check digit)."),
      { name: 'ValidationError', code: 'NUTRIBOT_UPC_REJECTED', context: { reason: 'check-digit', upc: '037000338368' } });
    executeMock.mockRejectedValueOnce(refusal);
    const res = mockRes();
    await handler({ query: { upc: '037000338368' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "That isn't a food barcode (check digit).", rejected: 'check-digit' });
  });

  it('lets any other failure reach the error middleware', async () => {
    executeMock.mockRejectedValueOnce(new Error('OFF down'));
    await expect(handler({ query: { upc: '037000338369' }, body: {} }, mockRes())).rejects.toThrow('OFF down');
  });

  it('logs food from a normal upc query param', async () => {
    const res = mockRes();
    await handler({ query: { upc: '016000275287' }, body: {} }, res);

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ upc: '016000275287' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to a bare numeric query key when upc is empty (Binary Eye ?upc=&CODE)', async () => {
    // Binary Eye "GET, add content to URL" appends the barcode after &,
    // so it arrives as a query key with no value: ?upc=&0643843714477
    const res = mockRes();
    await handler({ query: { upc: '', '0643843714477': '' }, body: {} }, res);

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ upc: '0643843714477' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to a bare numeric query key when upc is a literal %s placeholder', async () => {
    const res = mockRes();
    await handler({ query: { upc: '%s', '0180530000715': '' }, body: {} }, res);

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ upc: '0180530000715' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('strips a literal %s template placeholder concatenated onto the code (upc=%sCODE)', async () => {
    // A URL template with a leftover `upc=%s` gets the scanned code appended
    // with no separator, e.g. upc=%s0049000000450 — not a bare key.
    const res = mockRes();
    await handler({ query: { upc: '%s0049000000450' }, body: {} }, res);

    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ upc: '0049000000450' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('ignores non-numeric bare keys (member=... stays a param, not a upc)', async () => {
    const res = mockRes();
    await handler({ query: { upc: '', member: 'popeye' }, body: {} }, res);

    expect(executeMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects when upc is missing and no bare numeric key exists', async () => {
    const res = mockRes();
    await handler({ query: {}, body: {} }, res);

    expect(executeMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('rejects non-numeric upc values with no fallback available', async () => {
    const res = mockRes();
    await handler({ query: { upc: 'not-a-barcode' }, body: {} }, res);

    expect(executeMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
