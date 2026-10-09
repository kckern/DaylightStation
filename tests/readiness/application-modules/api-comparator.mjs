import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const types = new Set(['string', 'number', 'boolean', 'array', 'object']);
const kind = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
function validate(manifest, targets) {
  assert.equal(manifest?.schema, 'comparator-v1');
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0);
  const mode = targets?.mode ?? 'isolated';
  assert.ok(['isolated', 'live-reference'].includes(mode), 'unknown target mode');
  if (mode === 'isolated') {
    assert.equal(targets?.isolated, true, 'explicit isolated-target acknowledgement required');
  } else {
    assert.equal(targets.readOnlyReference, true, 'explicit read-only live reference required');
    assert.equal(targets.candidate?.isolated, true, 'candidate must use isolated storage and effects');
    assert.match(targets.candidate.workingTreeSha256, /^[a-f0-9]{64}$/);
    assert.match(targets.candidate.fixtureSha256, /^[a-f0-9]{64}$/);
    assert.ok(['independent-snapshot', 'matched-snapshot'].includes(targets.dataRelationship?.kind));
    assert.ok(typeof targets.dataRelationship.description === 'string' && targets.dataRelationship.description.trim().length > 0);
  }
  for (const side of ['reference', 'candidate']) {
    const target = targets[side];
    const url = new URL(target.url);
    assert.equal(url.protocol, 'http:');
    assert.ok(['127.0.0.1', '[::1]'].includes(url.hostname), 'only explicit loopback targets allowed');
    assert.ok(url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash);
    assert.match(target.sourceCommit, /^[a-f0-9]{40}$/);
    if (mode === 'isolated') {
      assert.match(target.fixtureSha256, /^[a-f0-9]{64}$/);
      assert.match(target.imageDigest, /^sha256:[a-f0-9]{64}$/);
    }
  }
  assert.notEqual(new URL(targets.reference.url).origin, new URL(targets.candidate.url).origin);
  if (mode === 'isolated' || targets.dataRelationship?.kind === 'matched-snapshot') {
    assert.match(targets.reference.fixtureSha256, /^[a-f0-9]{64}$/);
    assert.equal(targets.reference.fixtureSha256, targets.candidate.fixtureSha256);
  }
  const ids = new Set();
  for (const c of manifest.cases) {
    assert.ok(c.id && !ids.has(c.id)); ids.add(c.id);
    assert.deepEqual(c.safety, { reviewed: true, disposition: 'read-only', sideEffects: false, nonlocal: false, longLived: false }, 'explicit reviewed read-only local finite case required');
    assert.ok(['GET', 'HEAD'].includes(c.method));
    assert.match(c.path, /^\/(?!\/)/);
    assert.ok(!c.path.includes('\\') && !c.path.includes('#'));
    assert.equal(new URL(c.path, targets.reference.url).origin, new URL(targets.reference.url).origin);
    const e = c.expected;
    assert.ok(Number.isInteger(e?.status) && e.status >= 200 && e.status < 500, 'explicit non-server-error status required');
    assert.ok(e.headers && Object.keys(e.headers).length > 0);
    for (const [name, value] of Object.entries(e.headers)) { assert.equal(name, name.toLowerCase()); assert.equal(typeof value, 'string'); }
    assert.ok(['json', 'json-array', 'text'].includes(e.body?.kind));
    if (c.method === 'HEAD') assert.deepEqual(e.body, { kind: 'text', exact: '' }, 'HEAD requires an empty text body expectation');
    if (e.body.kind === 'json') {
      assert.ok(e.body.required && Object.keys(e.body.required).length > 0);
      for (const type of Object.values(e.body.required)) assert.ok(types.has(type));
      assert.ok(e.body.equals && Object.keys(e.body.equals).length > 0, 'independent expected JSON values required');
    } else if (e.body.kind === 'json-array') {
      assert.ok(Array.isArray(e.body.exact), 'independent exact array expectation required');
    } else assert.equal(typeof e.body.exact, 'string');
    const n = c.normalize ?? { jsonPaths: [], headers: [] };
    assert.ok(Array.isArray(n.jsonPaths) && Array.isArray(n.headers));
    for (const key of n.jsonPaths) {
      assert.ok(e.body.kind === 'json' && Object.hasOwn(e.body.required, key));
      assert.ok(!Object.hasOwn(e.body.equals, key), 'cannot normalize an expected value');
    }
    for (const header of n.headers) {
      assert.equal(header, header.toLowerCase());
      assert.ok(!Object.hasOwn(e.headers, header), 'cannot normalize a required header');
    }
  }
}
function inspect(response, c) {
  assert.equal(response.status, c.expected.status, 'unexpected status');
  const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v]));
  for (const [name, value] of Object.entries(c.expected.headers)) assert.equal(headers[name], value, `header ${name}`);
  let body = response.body;
  if (c.expected.body.kind === 'json') {
    body = JSON.parse(body);
    assert.equal(kind(body), 'object');
    for (const [key, type] of Object.entries(c.expected.body.required)) {
      assert.equal(kind(body[key]), type, `body schema ${key}`);
      if (type === 'number') assert.ok(Number.isFinite(body[key]));
      if (type === 'string') assert.ok(body[key].length > 0);
    }
    for (const [key, value] of Object.entries(c.expected.body.equals)) assert.deepEqual(body[key], value, `body value ${key}`);
    for (const key of c.normalize?.jsonPaths ?? []) delete body[key];
  } else if (c.expected.body.kind === 'json-array') {
    body = JSON.parse(body);
    assert.ok(Array.isArray(body), 'array response required');
    assert.deepEqual(body, c.expected.body.exact, 'expected array values and order');
  } else assert.equal(body, c.expected.body.exact);
  for (const header of c.normalize?.headers ?? []) delete headers[header];
  return { status: response.status, headers, body };
}

// Synthetic transports exercise this function without sockets. Real targets must be
// independently provisioned and reviewed; loopback and declared metadata are not
// isolation or provenance proof. Live mode keeps its reference data identity separate.
export async function compareApi({ manifest, targets, transport }) {
  validate(manifest, targets);
  assert.equal(typeof transport, 'function');
  const cases = [];
  for (const c of manifest.cases) {
    const observations = {};
    const errors = [];
    for (const side of ['reference', 'candidate']) {
      try {
        observations[side] = await transport({ side, url: new URL(c.path, targets[side].url).href, method: c.method });
        inspect(observations[side], c);
      } catch (error) { errors.push({ side, message: error.message }); }
    }
    if (errors.length === 0) {
      try { assert.deepEqual(inspect(observations.reference, c), inspect(observations.candidate, c)); }
      catch (error) { errors.push({ side: 'differential', message: error.message }); }
    }
    cases.push({ id: c.id, accepted: errors.length === 0, observations, errors });
  }
  return {
    schema: 'comparator-result-v1', mode: targets.mode ?? 'isolated',
    fixtureSha256: targets.reference.fixtureSha256 ?? null,
    declaredTargets: targets,
    accepted: cases.every(c => c.accepted), readinessAccepted: false,
    scope: 'Only the explicitly selected HTTP cases; no whole-API, side-effect, WebSocket, jobs, browser or lifecycle certification.',
    cases,
  };
}

export async function fetchTransport({ url, method }) {
  const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  // A fixed response limit keeps accidental stream endpoints out of this probe.
  const reader = response.body?.getReader();
  const chunks = []; let length = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length; assert.ok(length <= 1024 * 1024, 'response exceeds 1 MiB'); chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.concat(chunks).toString('utf8') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4, 'usage: node api-comparator.mjs MANIFEST.json TARGETS.json');
  const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const targets = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const result = await compareApi({ manifest, targets, transport: fetchTransport });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.accepted) process.exitCode = 1;
}
