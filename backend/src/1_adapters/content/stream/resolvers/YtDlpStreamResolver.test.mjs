import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YtDlpStreamResolver } from './YtDlpStreamResolver.mjs';

test('maps hls protocol to hls_video', async () => {
  const probe = async () => ({ title: 'T', url: 'https://cdn/x.m3u8', protocol: 'm3u8_native' });
  const r = new YtDlpStreamResolver({ probe });
  const out = await r.resolve('https://youtu.be/abc');
  assert.equal(out.format, 'hls_video');
  assert.equal(out.mediaUrl, 'https://cdn/x.m3u8');
  assert.equal(out.title, 'T');
});

test('maps progressive mp4 to video', async () => {
  const probe = async () => ({ title: 'T', url: 'https://cdn/x.mp4', protocol: 'https' });
  const r = new YtDlpStreamResolver({ probe });
  assert.equal((await r.resolve('https://vimeo.com/1')).format, 'video');
});

test('declines when probe throws / no url', async () => {
  const r = new YtDlpStreamResolver({ probe: async () => { throw new Error('unsupported'); } });
  assert.equal(await r.resolve('https://unknown.tld/x'), null);
});
