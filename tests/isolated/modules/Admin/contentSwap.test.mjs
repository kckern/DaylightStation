import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_PAYLOAD_FIELDS,
  IDENTITY_FIELDS,
  swapContentPayloads,
  ITEM_DEFAULTS
} from '../../../../frontend/src/modules/Admin/ContentLists/listConstants.js';

describe('CONTENT_PAYLOAD_FIELDS', () => {
  it('should not overlap with IDENTITY_FIELDS', () => {
    const overlap = CONTENT_PAYLOAD_FIELDS.filter(f => IDENTITY_FIELDS.includes(f));
    assert.deepStrictEqual(overlap, [], `Fields overlap: ${overlap.join(', ')}`);
  });

  it('should include input and action', () => {
    assert.ok(CONTENT_PAYLOAD_FIELDS.includes('input'));
    assert.ok(CONTENT_PAYLOAD_FIELDS.includes('action'));
  });

  it('should include all playback fields', () => {
    for (const field of ['shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate']) {
      assert.ok(CONTENT_PAYLOAD_FIELDS.includes(field), `Missing: ${field}`);
    }
  });
});

describe('swapContentPayloads', () => {
  it('should swap content fields between two items', () => {
    const itemA = { label: 'Morning', image: '/img/a.jpg', uid: 'uid-a', active: true, input: 'plex:123', action: 'Play', shuffle: true, volume: 80 };
    const itemB = { label: 'Evening', image: '/img/b.jpg', uid: 'uid-b', active: false, input: 'abs:456', action: 'Queue', shuffle: false, volume: 100 };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    // A gets B's content
    assert.equal(updatesForA.input, 'abs:456');
    assert.equal(updatesForA.action, 'Queue');
    assert.equal(updatesForA.shuffle, false);
    assert.equal(updatesForA.volume, 100);

    // B gets A's content
    assert.equal(updatesForB.input, 'plex:123');
    assert.equal(updatesForB.action, 'Play');
    assert.equal(updatesForB.shuffle, true);
    assert.equal(updatesForB.volume, 80);
  });

  it('should not include identity fields in swap', () => {
    const itemA = { label: 'A', image: '/a.jpg', uid: 'a', active: true, input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', image: '/b.jpg', uid: 'b', active: false, input: 'plex:2', action: 'List' };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    assert.equal(updatesForA.label, undefined);
    assert.equal(updatesForA.image, undefined);
    assert.equal(updatesForA.uid, undefined);
    assert.equal(updatesForA.active, undefined);
    assert.equal(updatesForB.label, undefined);
    assert.equal(updatesForB.image, undefined);
  });

  it('should handle undefined fields by using ITEM_DEFAULTS', () => {
    const itemA = { label: 'A', input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', input: 'plex:2', action: 'List', shuffle: true };

    const { updatesForA } = swapContentPayloads(itemA, itemB);
    // B has shuffle=true, so A should get it
    assert.equal(updatesForA.shuffle, true);

    const { updatesForB } = swapContentPayloads(itemA, itemB);
    // A has no shuffle, so B should get the default (false)
    assert.equal(updatesForB.shuffle, ITEM_DEFAULTS.shuffle);
  });
});
