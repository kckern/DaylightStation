import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PhotoStore, isValidPhotoRef, PHOTO_REF_PATTERN } from './PhotoStore.mjs';

// A tiny real JPEG (4x4 solid red, produced by jimp itself) so jimp can
// actually decode it and produce a thumbnail — round-trip tests exercise the
// real thumbnail path, not a stub.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAQABAMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APxfr/Kc/wC/g//Z';

function makeDataService(dir) {
  return { user: { resolveDir: (rel, userId) => path.join(dir, 'users', userId, rel) } };
}

let dir, store, logs;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photostore-'));
  logs = { warn: [] };
  store = new PhotoStore({
    dataService: makeDataService(dir),
    logger: { warn: (...a) => logs.warn.push(a), info: () => {}, debug: () => {} },
  });
});

describe('PhotoStore', () => {
  it('save() writes an original file and returns a ph_-prefixed ref matching the allowlist', async () => {
    const buffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
    const photoRef = await store.save('alice', buffer, { contentType: 'image/jpeg' });
    expect(photoRef).toMatch(/^ph_[A-Za-z0-9]+$/);
    expect(PHOTO_REF_PATTERN.test(photoRef)).toBe(true);

    const originalPath = path.join(dir, 'users', 'alice', 'lifelog/nutrition/photos', `${photoRef}.jpg`);
    expect(fs.existsSync(originalPath)).toBe(true);
    expect(fs.readFileSync(originalPath)).toEqual(buffer);
  });

  it('save() also produces a real thumbnail alongside the original', async () => {
    const buffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
    const photoRef = await store.save('alice', buffer);
    const thumbPath = path.join(dir, 'users', 'alice', 'lifelog/nutrition/photos', `${photoRef}.thumb.jpg`);
    expect(fs.existsSync(thumbPath)).toBe(true);
    // Thumbnail bytes differ from the original (it was actually processed).
    expect(fs.readFileSync(thumbPath)).not.toEqual(buffer);
  });

  it('round trip: save() then resolvePath() returns a real, readable path', async () => {
    const buffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
    const photoRef = await store.save('bob', buffer);
    const resolved = store.resolvePath('bob', photoRef);
    expect(resolved).toBeTruthy();
    expect(fs.readFileSync(resolved)).toEqual(buffer);
  });

  it('round trip with size=thumb returns the thumbnail path when it exists', async () => {
    const buffer = Buffer.from(TINY_JPEG_BASE64, 'base64');
    const photoRef = await store.save('bob', buffer);
    const resolved = store.resolvePath('bob', photoRef, { size: 'thumb' });
    expect(resolved).toBeTruthy();
    expect(resolved.endsWith('.thumb.jpg')).toBe(true);
  });

  it('a failing thumbnail (undecodable buffer) still lets save() succeed, and size=thumb falls back to the original', async () => {
    const garbage = Buffer.from('this is not an image at all, just bytes', 'utf8');
    const photoRef = await store.save('carol', garbage);
    expect(photoRef).toMatch(/^ph_/);
    expect(logs.warn.some(([event]) => event === 'PhotoStore.thumbnail.failed')).toBe(true);

    const original = store.resolvePath('carol', photoRef);
    expect(original).toBeTruthy();
    const thumbFallback = store.resolvePath('carol', photoRef, { size: 'thumb' });
    expect(thumbFallback).toBe(original); // fell back to serving the original
  });

  it('resolvePath returns null for a missing ref (well-formed but never saved)', () => {
    expect(store.resolvePath('alice', 'ph_doesnotexist12345')).toBeNull();
  });

  it('resolvePath returns null for an empty ref', () => {
    expect(store.resolvePath('alice', '')).toBeNull();
    expect(store.resolvePath('alice', undefined)).toBeNull();
    expect(store.resolvePath('alice', null)).toBeNull();
  });

  it('resolvePath rejects ../../../etc/passwd style traversal outright', () => {
    expect(store.resolvePath('alice', '../../../etc/passwd')).toBeNull();
    expect(isValidPhotoRef('../../../etc/passwd')).toBe(false);
  });

  it('resolvePath rejects a ref with an embedded traversal segment: ph_../../secret', () => {
    expect(store.resolvePath('alice', 'ph_../../secret')).toBeNull();
    expect(isValidPhotoRef('ph_../../secret')).toBe(false);
  });

  it('resolvePath rejects a percent-encoded traversal form (never decoded then trusted)', () => {
    // A caller must never URL-decode before calling resolvePath. Even if one
    // did, the literal encoded text also fails the allowlist.
    expect(store.resolvePath('alice', 'ph_%2e%2e%2f%2e%2e%2fsecret')).toBeNull();
    expect(isValidPhotoRef('%2e%2e%2f')).toBe(false);
  });

  it('resolvePath rejects a null-byte-bearing ref', () => {
    expect(store.resolvePath('alice', 'ph_abc\0def')).toBeNull();
  });

  it('resolvePath rejects an absolute-path-shaped ref', () => {
    expect(store.resolvePath('alice', '/etc/passwd')).toBeNull();
    expect(store.resolvePath('alice', 'ph_/etc/passwd')).toBeNull();
  });

  it('never deletes anything it did not just overwrite — PhotoStore exposes no delete method', () => {
    expect(typeof store.delete).toBe('undefined');
    expect(typeof store.remove).toBe('undefined');
  });

  it('save() throws (does not silently no-op) for a missing/empty buffer, so callers can catch and continue', async () => {
    await expect(store.save('alice', null)).rejects.toThrow();
    await expect(store.save('alice', Buffer.alloc(0))).rejects.toThrow();
  });

  it('save() throws for a missing userId', async () => {
    await expect(store.save(undefined, Buffer.from(TINY_JPEG_BASE64, 'base64'))).rejects.toThrow();
  });
});
