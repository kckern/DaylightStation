// tests/unit/api/handlers/nutribot/directInput.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { directUPCHandler } from '../../../../../backend/src/4_api/v1/handlers/nutribot/directInput.mjs';

describe('directUPCHandler', () => {
  let executeMock;
  let container;
  let identityAdapter;
  let handler;

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    executeMock = jest.fn().mockResolvedValue({ success: true });
    container = { getLogFoodFromUPC: () => ({ execute: executeMock }) };
    identityAdapter = {
      resolve: jest.fn().mockReturnValue({ username: 'kckern', conversationIdString: 'telegram:1_2' }),
    };
    handler = directUPCHandler(container, {
      identityAdapter,
      defaultMember: 'kckern',
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
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
