/**
 * Unit tests for shared/utils/webcamFilters.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  webcamFilters,
  getWebcamFilter,
  resolveFilterId,
  getFilterIds,
  getFilterOptions,
  DEFAULT_FILTER_ID
} from '../webcamFilters.js';

// =============================================================================
// webcamFilters object tests
// =============================================================================

test('webcamFilters contains expected filter definitions', () => {
  assert.ok(webcamFilters.none, 'none filter should exist');
  assert.ok(webcamFilters.grayscale, 'grayscale filter should exist');
  assert.ok(webcamFilters.mirrorAdaptive, 'mirrorAdaptive filter should exist');
  assert.ok(webcamFilters.softBlur, 'softBlur filter should exist');
  assert.ok(webcamFilters.punchy, 'punchy filter should exist');
  assert.ok(webcamFilters.vignette, 'vignette filter should exist');
});

test('webcamFilters each have required properties', () => {
  for (const [id, filter] of Object.entries(webcamFilters)) {
    assert.equal(filter.id, id, `Filter ${id} should have matching id`);
    assert.ok(typeof filter.label === 'string', `Filter ${id} should have label`);
    assert.ok(typeof filter.apply === 'function', `Filter ${id} should have apply function`);
    assert.ok('css' in filter, `Filter ${id} should have css property`);
  }
});

// =============================================================================
// DEFAULT_FILTER_ID tests
// =============================================================================

test('DEFAULT_FILTER_ID is mirrorAdaptive', () => {
  assert.equal(DEFAULT_FILTER_ID, 'mirrorAdaptive');
});

// =============================================================================
// getWebcamFilter tests
// =============================================================================

test('getWebcamFilter: returns correct filter by ID', () => {
  const filter = getWebcamFilter('grayscale');
  assert.equal(filter.id, 'grayscale');
  assert.equal(filter.label, 'Grayscale');
});

test('getWebcamFilter: returns default filter for invalid ID', () => {
  const filter = getWebcamFilter('nonexistent');
  assert.equal(filter.id, DEFAULT_FILTER_ID);
});

test('getWebcamFilter: returns default filter for null/undefined', () => {
  assert.equal(getWebcamFilter(null).id, DEFAULT_FILTER_ID);
  assert.equal(getWebcamFilter(undefined).id, DEFAULT_FILTER_ID);
});

// =============================================================================
// resolveFilterId tests
// =============================================================================

test('resolveFilterId: returns valid ID unchanged', () => {
  assert.equal(resolveFilterId('none'), 'none');
  assert.equal(resolveFilterId('grayscale'), 'grayscale');
  assert.equal(resolveFilterId('mirrorAdaptive'), 'mirrorAdaptive');
});

test('resolveFilterId: returns default for invalid ID', () => {
  assert.equal(resolveFilterId('invalid'), DEFAULT_FILTER_ID);
  assert.equal(resolveFilterId(null), DEFAULT_FILTER_ID);
  assert.equal(resolveFilterId(''), DEFAULT_FILTER_ID);
});

// =============================================================================
// getFilterIds tests
// =============================================================================

test('getFilterIds: returns array of all filter IDs', () => {
  const ids = getFilterIds();
  assert.ok(Array.isArray(ids));
  assert.ok(ids.includes('none'));
  assert.ok(ids.includes('grayscale'));
  assert.ok(ids.includes('mirrorAdaptive'));
  assert.ok(ids.length >= 6, 'Should have at least 6 filters');
});

// =============================================================================
// getFilterOptions tests
// =============================================================================

test('getFilterOptions: returns array of {id, label} objects', () => {
  const options = getFilterOptions();
  assert.ok(Array.isArray(options));
  
  for (const option of options) {
    assert.ok(typeof option.id === 'string');
    assert.ok(typeof option.label === 'string');
  }
});

test('getFilterOptions: includes all filters', () => {
  const options = getFilterOptions();
  const ids = options.map(o => o.id);
  
  assert.ok(ids.includes('none'));
  assert.ok(ids.includes('grayscale'));
  assert.ok(ids.includes('mirrorAdaptive'));
});

// =============================================================================
// Filter apply function tests
// =============================================================================

test('filter apply functions are callable without errors', () => {
  // Create mock context and video
  const mockCtx = {
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillRect: () => {},
    filter: 'none',
    fillStyle: '',
    createRadialGradient: () => ({
      addColorStop: () => {}
    })
  };
  
  const mockVideo = {};
  const width = 640;
  const height = 480;
  
  // Test that each filter's apply function is callable
  for (const [id, filter] of Object.entries(webcamFilters)) {
    assert.doesNotThrow(() => {
      filter.apply(mockCtx, mockVideo, width, height);
    }, `Filter ${id} apply function should not throw`);
  }
});

test('none filter draws video directly', () => {
  let drawImageCalled = false;
  const mockCtx = {
    drawImage: () => { drawImageCalled = true; },
    filter: 'none'
  };
  
  webcamFilters.none.apply(mockCtx, {}, 640, 480);
  assert.ok(drawImageCalled, 'drawImage should be called');
});

test('grayscale filter sets filter property', () => {
  let filterValue = '';
  const mockCtx = {
    drawImage: () => {},
    get filter() { return filterValue; },
    set filter(v) { filterValue = v; }
  };
  
  webcamFilters.grayscale.apply(mockCtx, {}, 640, 480);
  // Filter gets reset to 'none' at the end
  assert.equal(filterValue, 'none');
});
