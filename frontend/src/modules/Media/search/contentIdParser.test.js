import { test, expect } from 'vitest';
import { parseContentId } from './contentIdParser.js';

test('parses plex-main:12345', () => {
  expect(parseContentId('plex-main:12345')).toEqual({ source: 'plex-main', localId: '12345' });
});

test('parses singalong:198', () => {
  expect(parseContentId('singalong:198')).toEqual({ source: 'singalong', localId: '198' });
});

test('parses sources with sub-paths', () => {
  expect(parseContentId('app:webcam/front-door')).toEqual({
    source: 'app',
    localId: 'webcam/front-door',
  });
});

test('trims whitespace around the input', () => {
  expect(parseContentId('  plex:1  ')).toEqual({ source: 'plex', localId: '1' });
});

test('returns null for free-text', () => {
  expect(parseContentId('lonesome')).toBeNull();
});

test('returns null when the source token is empty', () => {
  expect(parseContentId(':12345')).toBeNull();
});

test('returns null when the localId is empty', () => {
  expect(parseContentId('plex:')).toBeNull();
});

test('returns null for non-string input', () => {
  expect(parseContentId(null)).toBeNull();
  expect(parseContentId(undefined)).toBeNull();
  expect(parseContentId(123)).toBeNull();
});
