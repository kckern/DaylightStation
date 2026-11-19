import axios from 'axios';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createPortalInputLock } from '../../5_composition/modules/supervision.mjs';

const fixture = new URL('../../../../_extensions/daylight-android/capabilities/lockdown/payload/src/test/resources/ordered-lockdown.json', import.meta.url);
const commands = JSON.parse(readFileSync(fixture, 'utf8'));

it.each(['daylight-android', 'fully-kiosk'])('round trips ordered stop and release on the %s wire', async provider => {
  const received = [];
  function receive(method, url, body, headers) {
    const row = commands[received.length];
    const daylight = provider === 'daylight-android';
    expect(method).toBe(daylight ? 'POST' : 'PUT');
    expect(new URL(url).pathname).toBe(daylight ? '/lockdown/input' : '/lockdown');
    expect(headers[daylight ? 'X-Daylight-Token' : 'X-Lockdown-Token']).toBe('fixture');
    received.push(JSON.parse(body));
    expect(received.at(-1)).toEqual(row.request);
    return JSON.stringify(daylight ? row.daylight : row.legacy);
  }
  const actuator = createPortalInputLock({
    deviceId: 'portal',
    configService: {
      getDeviceConfig: () => ({ content_control: { provider, host: 'portal.invalid', auth_ref: 'android' } }),
      getHouseholdAuth: ref => ref === 'android' ? { portal: { token: 'fixture' } } : { token: 'fixture' },
    },
    portalKeys: { base_url: 'http://legacy.invalid', auth_ref: 'keys' },
    httpClient: axios.create({ adapter: async config => ({
      status: 200, data: receive(config.method.toUpperCase(), config.url, config.data, config.headers),
    }) }),
    fetchFn: async (url, options) => new Response(receive(options.method, url, options.body, options.headers)),
    logger: {},
  });
  for (const { action, request } of commands) {
    expect(await actuator[action]({ commandRevision: request.revision })).toEqual({
      ok: true, blocked: request.locked, commandRevision: request.revision,
    });
  }
  expect(received).toHaveLength(commands.length);
});
