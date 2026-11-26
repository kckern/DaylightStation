import { describe, it, expect } from 'vitest';
import { redactUrl, formatAxiosError } from './httpClient.mjs';

// A failed request's log line held a kiosk's password in its URL; credentials are masked.
describe('redactUrl', () => {
  it('masks credential parameters and keeps the rest', () => {
    expect(redactUrl('http://10.0.0.1:2323/?cmd=deviceInfo&type=json&password=hunter2'))
      .toBe('http://10.0.0.1:2323/?cmd=deviceInfo&type=json&password=***');
    expect(redactUrl('https://plex.example/library?X-Plex-Token=abc&type=10')).toBe('https://plex.example/library?X-Plex-Token=***&type=10');
    expect(redactUrl('https://x/a?api_key=1&apikey=2&signature=3&q=ok#frag')).toBe('https://x/a?api_key=***&apikey=***&signature=***&q=ok#frag');
  });
  it('leaves URLs without credentials alone', () => {
    expect(redactUrl('http://x/a?cmd=deviceInfo')).toBe('http://x/a?cmd=deviceInfo');
    expect(redactUrl('http://x/a')).toBe('http://x/a');
    expect(redactUrl(undefined)).toBe(undefined);
  });
  it('is applied to the failed-request line', () => {
    const line = formatAxiosError({ config: { method: 'get', url: 'http://10.0.0.1:2323/?cmd=deviceInfo&password=hunter2' }, message: 'connect EHOSTUNREACH' });
    expect(line).toContain('password=***');
    expect(line).not.toContain('hunter2');
  });
});
