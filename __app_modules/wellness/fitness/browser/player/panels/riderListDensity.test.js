import { describe, expect, it } from 'vitest';
import { allocateRiderHeight, measureRiderHeight } from './riderListDensity.js';

describe('continuous roster allocation', () => {
  it('fills available space continuously for five riders', () => {
    expect(allocateRiderHeight({ room: 600, overhead: 100, count: 5 })).toBe(100);
    expect(allocateRiderHeight({ room: 625, overhead: 100, count: 5 })).toBe(105);
  });
  it.each([[5, 160], [3, 266]])('fills tall available room for %i riders without a single-card cap', (count, height) => {
    expect(allocateRiderHeight({ room: 900, overhead: 100, count })).toBe(height);
  });
  it('caps a single card and scrolls at readable minimum', () => {
    expect(allocateRiderHeight({ room: 700, overhead: 30, count: 1 })).toBe(132);
    expect(allocateRiderHeight({ room: 400, overhead: 100, count: 8 })).toBe(64);
  });
  it('measures children independently of the animated grid height', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="device-grid"><div class="device-wrapper"><div class="device-zone-info"></div><div class="fitness-device card-horizontal heart-rate"></div></div><div class="rpm-group-container"></div></div>';
    document.body.append(container);
    Object.defineProperty(container, 'clientHeight', { value: 300 });
    const grid = container.firstChild;
    grid.style.gap = '10px';
    grid.style.height = '900px'; // FlipMove's maintained height is irrelevant.
    grid.children[0].getBoundingClientRect = () => ({ height: 90 });
    grid.querySelector('.fitness-device').getBoundingClientRect = () => ({ height: 64 });
    grid.children[1].getBoundingClientRect = () => ({ height: 64 });
    expect(measureRiderHeight(container, container)).toBe(132);
    expect(grid.style.height).toBe('900px');
  });
  it('does not reserve room for a leaving absolute equipment group', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="device-grid"><div class="device-wrapper"><div class="fitness-device card-horizontal heart-rate"></div></div><div class="rpm-group-container" style="position:absolute"></div></div>';
    document.body.append(container);
    Object.defineProperty(container, 'clientHeight', { value: 300 });
    container.firstChild.children[0].getBoundingClientRect = () => ({ height: 64 });
    container.querySelector('.fitness-device').getBoundingClientRect = () => ({ height: 64 });
    container.querySelector('.rpm-group-container').getBoundingClientRect = () => ({ height: 250 });
    expect(measureRiderHeight(container, container)).toBe(132);
  });
});
