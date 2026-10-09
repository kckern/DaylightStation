import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  validateManifest(manifest, targets.reference.url);
}
function validateManifest(manifest, origin) {
  assert.equal(manifest?.schema, 'comparator-v1');
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0);
  const ids = new Set();
  for (const c of manifest.cases) {
    assert.ok(c.id && !ids.has(c.id)); ids.add(c.id);
    assert.deepEqual(c.safety, { reviewed: true, disposition: 'read-only', sideEffects: false, nonlocal: false, longLived: false }, 'explicit reviewed read-only local finite case required');
    assert.ok(['GET', 'HEAD'].includes(c.method));
    assert.match(c.path, /^\/(?!\/)/);
    assert.ok(!c.path.includes('\\') && !c.path.includes('#'));
    assert.equal(new URL(c.path, origin).origin, new URL(origin).origin);
    const e = c.expected;
    assert.ok(Number.isInteger(e?.status) && e.status >= 200 && e.status < 500, 'explicit non-server-error status required');
    assert.ok(e.headers && Object.keys(e.headers).length > 0);
    for (const [name, value] of Object.entries(e.headers)) { assert.equal(name, name.toLowerCase()); assert.equal(typeof value, 'string'); }
    assert.ok(['json', 'json-array', 'text', 'binary'].includes(e.body?.kind));
    if (c.method === 'HEAD') assert.deepEqual(e.body, { kind: 'text', exact: '' }, 'HEAD requires an empty text body expectation');
    if (e.body.kind === 'json') {
      assert.ok(e.body.required && Object.keys(e.body.required).length > 0);
      for (const type of Object.values(e.body.required)) assert.ok(types.has(type));
      assert.ok(e.body.equals && Object.keys(e.body.equals).length > 0, 'independent expected JSON values required');
    } else if (e.body.kind === 'json-array') {
      assert.ok(Array.isArray(e.body.exact), 'independent exact array expectation required');
    } else if (e.body.kind === 'binary') {
      assert.ok(Number.isInteger(e.body.byteLength) && e.body.byteLength > 0 && e.body.byteLength <= 1048576);
      assert.match(e.body.sha256, /^[a-f0-9]{64}$/);
      assert.ok(e.headers['content-type'], 'Binary MIME required');
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
  } else if (c.expected.body.kind === 'binary') {
    assert.equal(typeof response.bodyBase64, 'string', 'Raw binary bytes required');
    const bytes = Buffer.from(response.bodyBase64, 'base64');
    assert.equal(bytes.toString('base64'), response.bodyBase64, 'Canonical binary bytes required');
    assert.ok(bytes.length <= 1048576, 'response exceeds 1 MiB');
    assert.equal(bytes.length, c.expected.body.byteLength, 'Binary byte length');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), c.expected.body.sha256, 'Binary SHA256');
    body = response.bodyBase64; // Exact reference/candidate byte equality, no text decoding.
  } else assert.equal(body, c.expected.body.exact);
  for (const header of c.normalize?.headers ?? []) delete headers[header];
  return { status: response.status, headers, body };
}

// Synthetic transports exercise this function without sockets. Real targets must be
// independently provisioned and reviewed; loopback and declared metadata are not
// isolation or provenance proof. Live mode keeps its reference data identity separate.
export async function compareApi({ manifest, targets, transport }) {
  validate(manifest, targets);
  return compareValidated({ manifest, targets, transport });
}
async function compareValidated({ manifest, targets, transport }) {
  assert.equal(typeof transport, 'function');
  const cases = [];
  for (const c of manifest.cases) {
    const observations = {};
    const errors = [];
    for (const side of ['reference', 'candidate']) {
      try {
        observations[side] = await transport({ side, caseId:c.id, url: new URL(c.path, targets[side].url).href, method: c.method, bodyKind: c.expected.body.kind });
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

// Admission is shared by capture and offline replay, before any socket request.
export function validateCaptureManifest(manifest) {
  validateManifest(manifest, 'http://127.0.0.1:43129');
  for (const c of manifest.cases) {
    assert.equal(c.method, 'GET');
    assert.ok(!Object.hasOwn(c, 'headers') && !Object.hasOwn(c, 'body'), 'Capture has no credentials, headers or body');
    const url = new URL(c.path, 'http://127.0.0.1:43129');
    for (const key of url.searchParams.keys()) assert.ok(!/^(sid|cookie|authorization|bearer|token)$/i.test(key), 'Credential query denied');
  }
}
export async function compareCapturedApi({ manifest, manifestSha256, pairNonce, fixtureFileSha256,
  runtimeSha256, harnessSha256, runs, guardsAccepted }) {
  validateCaptureManifest(manifest);
  assert.equal(guardsAccepted, true, 'Fresh coordinator input guards required');
  assert.match(pairNonce, /^[a-f0-9]{32}$/);
  assert.equal(createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), manifestSha256, 'Manifest identity mismatch');
  for (const pin of [fixtureFileSha256, runtimeSha256, harnessSha256]) assert.match(pin, /^[a-f0-9]{64}$/);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(run => run.role), ['original', 'candidate']);
  assert.notEqual(runs[0].sourceCommit, runs[1].sourceCommit);
  assert.notEqual(runs[0].receipt.file, runs[1].receipt.file);
  assert.notEqual(runs[0].capture.file, runs[1].capture.file);
  const load = async pin => {
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(pin.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, 'Stored evidence tampered');
    return JSON.parse(bytes);
  };
  const captures = [];
  for (const run of runs) {
    assert.match(run.sourceCommit, /^[a-f0-9]{40}$/); assert.match(run.workingTreeSha256, /^[a-f0-9]{64}$/);
    const receipt = await load(run.receipt), capture = await load(run.capture);
    assert.equal(receipt.schema, 'local-app-result-v1');
    assert.ok(receipt.completed && receipt.controls && receipt.protectedInputsUnchanged, 'Final guarded controls receipt required');
    assert.equal(receipt.exitCode, 0); assert.equal(receipt.signal, null);
    assert.equal(receipt.sourceCommit, run.sourceCommit);
    assert.equal(capture.schema, 'isolated-api-capture-v1');
    assert.equal(capture.url, 'http://127.0.0.1:43129');
    for (const [key, value] of Object.entries({role:run.role, pairNonce, sourceCommit:run.sourceCommit,
      workingTreeSha256:run.workingTreeSha256, fixtureFileSha256, runtimeSha256, harnessSha256, manifestSha256})) {
      assert.equal(capture[key], value, 'Capture linkage: '+key);
      if(key !== 'sourceCommit') assert.equal(receipt.capture[key], value, 'Receipt linkage: '+key);
    }
    assert.equal(receipt.capture.file, run.capture.file); assert.equal(receipt.capture.sha256, run.capture.sha256);
    assert.equal(receipt.fixtureSha256, capture.fixtureSha256); assert.equal(receipt.runtimeTimezone, capture.runtimeTimezone);
    assert.equal(receipt.capture.startedAt, capture.startedAt); assert.equal(receipt.capture.endedAt, capture.endedAt);
    assert.ok(Number.isFinite(capture.startedAt) && Number.isFinite(capture.endedAt) && capture.startedAt < capture.endedAt);
    assert.equal(capture.cases.length, manifest.cases.length);
    for (const [i, c] of manifest.cases.entries()) {
      const row = capture.cases[i];
      assert.deepEqual(Object.keys(row).sort(), ['id','method','path','url','bodyKind','observed'].sort(), 'Unexpected captured request fields');
      for (const [key, value] of Object.entries({id:c.id,method:c.method,path:c.path,bodyKind:c.expected.body.kind,url:new URL(c.path,capture.url).href})) assert.equal(row[key],value,'Request linkage: '+key);
    }
    captures.push(capture);
  }
  assert.ok(captures[0].endedAt <= captures[1].startedAt, 'Listeners must be sequential');
  assert.equal(captures[0].fixtureSha256, captures[1].fixtureSha256);
  assert.equal(captures[0].runtimeTimezone, captures[1].runtimeTimezone);
  const targets = { mode:'captured-isolated', reference:captures[0], candidate:captures[1] };
  const result = await compareValidated({ manifest, targets, transport:async ({side,caseId,url,method,bodyKind}) => {
    const capture = captures[side === 'reference' ? 0 : 1];
    const row = capture.cases.find(row => row.id === caseId && row.url === url && row.method === method && row.bodyKind === bodyKind);
    assert.ok(row, 'No verified stored request'); return row.observed;
  }});
  result.declaredTargets = Object.fromEntries(Object.entries(targets).map(([key,value]) => [key,typeof value === 'object' ? { ...value, cases:undefined } : value]));
  result.evidence = runs; result.productionOrLiveCoverage = false;
  return result;
}

export async function fetchTransport({ url, method, bodyKind }) {
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
  const bytes = Buffer.concat(chunks);
  return { status: response.status, headers: Object.fromEntries(response.headers),
    ...(bodyKind === 'binary' ? { bodyBase64: bytes.toString('base64') } : { body: bytes.toString('utf8') }) };

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 4, 'usage: node api-comparator.mjs MANIFEST.json TARGETS.json');
  const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const targets = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const result = await compareApi({ manifest, targets, transport: fetchTransport });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.accepted) process.exitCode = 1;
}
