import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeVideoId } from './YouTubeVideoId.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

test('accepts a canonical 11-char id', () => {
  const id = new YouTubeVideoId('F1sMvm6D-0Y');
  assert.equal(id.value, 'F1sMvm6D-0Y');
  assert.equal(id.toString(), 'F1sMvm6D-0Y');
});

test('exposes routing-safe watch and embed urls', () => {
  const id = new YouTubeVideoId('F1sMvm6D-0Y');
  assert.equal(id.watchUrl, 'https://www.youtube.com/watch?v=F1sMvm6D-0Y');
  assert.equal(id.embedUrl, 'https://www.youtube.com/embed/F1sMvm6D-0Y?autoplay=1');
});

test('is immutable', () => {
  const id = new YouTubeVideoId('F1sMvm6D-0Y');
  assert.throws(() => { id.value = 'x'; });
});

test('rejects empty', () => {
  assert.throws(() => new YouTubeVideoId(''), ValidationError);
});

test('rejects wrong length', () => {
  assert.throws(() => new YouTubeVideoId('abc'), ValidationError);
  assert.throws(() => new YouTubeVideoId('F1sMvm6D-0YEXTRA'), ValidationError);
});

test('rejects illegal characters', () => {
  assert.throws(() => new YouTubeVideoId('F1sMvm6D-0!'), ValidationError);
  assert.throws(() => new YouTubeVideoId('F1sMvm6D/0Y'), ValidationError);
});

test('rejects non-string', () => {
  assert.throws(() => new YouTubeVideoId(null), ValidationError);
  assert.throws(() => new YouTubeVideoId(undefined), ValidationError);
});
