// backend/src/1_adapters/persistence/yaml/YamlUserProfileDatastore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YamlUserProfileDatastore } from './YamlUserProfileDatastore.mjs';

test('readProfile loads <userDir>/profile.yml via the injected loader', () => {
  let loadedPath;
  const store = new YamlUserProfileDatastore({
    configService: { getUserDir: (u) => `/data/users/${u}` },
    load: (p) => { loadedPath = p; return { username: 'test-user' }; },
    save: () => {},
  });
  const profile = store.readProfile('test-user');
  assert.equal(loadedPath, '/data/users/test-user/profile.yml');
  assert.deepEqual(profile, { username: 'test-user' });
});

test('readProfile returns null when the file is missing', () => {
  const store = new YamlUserProfileDatastore({
    configService: { getUserDir: (u) => `/data/users/${u}` },
    load: () => null,
    save: () => {},
  });
  assert.equal(store.readProfile('ghost'), null);
});

test('writeProfile saves to <userDir>/profile.yml via the injected saver', () => {
  let savedPath; let savedContent;
  const store = new YamlUserProfileDatastore({
    configService: { getUserDir: (u) => `/data/users/${u}` },
    load: () => ({}),
    save: (p, c) => { savedPath = p; savedContent = c; },
  });
  store.writeProfile('test-user', { identities: { fingerprints: [{ id: 'u1' }] } });
  assert.equal(savedPath, '/data/users/test-user/profile.yml');
  assert.deepEqual(savedContent, { identities: { fingerprints: [{ id: 'u1' }] } });
});

test('constructor rejects a configService without getUserDir', () => {
  assert.throws(() => new YamlUserProfileDatastore({ configService: {} }), /getUserDir/);
});
