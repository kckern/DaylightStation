import { describe, it, expect, beforeEach } from 'vitest';
import { FixHubSlot } from "../../../__app_modules/media/media/server/application/playback-hub/usecases/FixHubSlot.mjs";
import { FakeHubGateway } from "../../../__app_modules/media/media/server/application/playback-hub/test/FakeHubGateway.mjs";
import { ValidationError } from '../../../__backend/src/2_domains/core/errors/ValidationError.mjs';

describe('FixHubSlot', () => {
  let gateway, useCase;
  beforeEach(() => {
    gateway = new FakeHubGateway();
    useCase = new FixHubSlot({ gateway, logger: { info() {} } });
  });

  it('passes the colour to the hub and returns its one-line result unchanged', async () => {
    gateway.fixResult = { ok: false, code: 'absent', result: "Couldn't reach the speaker" };
    const out = await useCase.execute({ color: 'green' });
    expect(out).toEqual({ ok: false, code: 'absent', result: "Couldn't reach the speaker" });
    expect(gateway.fixCalls).toEqual([{ color: 'green' }]);
  });

  it('rejects an empty colour without calling the hub', async () => {
    await expect(useCase.execute({ color: '' })).rejects.toThrow(ValidationError);
    expect(gateway.fixCalls).toEqual([]);
  });
});
