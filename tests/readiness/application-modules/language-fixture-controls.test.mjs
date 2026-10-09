import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { validateRawFixtures } from './raw-utf8-fixture.mjs';
import { fetchTransport } from './api-comparator.mjs';
const row = (destination, bytes, encoding) => ({ destination, encoding, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, base64: bytes.toString('base64') });
test('Language fixture extension preserves canonical corpus and exact prompt/cue MP3 bytes', () => {
  const corpus = row('data/content/school/language/glossika-korean.yml', Buffer.from('id: authored\n'), 'utf8');
  const mp3 = Buffer.from([255, 251, 128, 0]);
  const fixture = { fixtureFiles: {}, rawUTF8Files: [corpus], rawBinaryFiles: [row('media/school/language/glossika-korean/0104-EN.mp3', mp3, 'binary'), row('media/school/_ux/ding.mp3', mp3, 'binary')] };
  const before = JSON.stringify(fixture); validateRawFixtures(fixture); assert.equal(JSON.stringify(fixture), before);
  for (const destination of ['media/school/language/glossika-korean/../0104-EN.mp3', 'media/school/language/glossika-korean/recordings/user/0104-EN.mp3', 'media/school/_ux/arbitrary.mp3', 'data/content/school/language/config.yml/extra']) {
    assert.throws(() => validateRawFixtures({ fixtureFiles: {}, rawBinaryFiles: [row(destination, mp3, 'binary')] }));
  }
});
test('bounded fetch transport retains binary bytes and existing text/JSON response shape', async () => {
  const bytes = Buffer.from([255, 128, 65]);
  const server = createServer((req, res) => { res.setHeader('content-type', req.url === '/binary' ? 'audio/mpeg' : 'application/json'); res.end(req.url === '/binary' ? bytes : '{"ok":true}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const binary = await fetchTransport({ url: url + '/binary', method: 'GET', bodyKind: 'binary' });
    assert.equal(binary.bodyBase64, bytes.toString('base64')); assert.ok(!Object.hasOwn(binary, 'body'));
    const json = await fetchTransport({ url: url + '/json', method: 'GET', bodyKind: 'json' });
    assert.equal(json.body, '{"ok":true}'); assert.ok(!Object.hasOwn(json, 'bodyBase64'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
