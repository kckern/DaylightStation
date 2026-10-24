import { describe, expect, it } from 'vitest';
import { allocateRiderHeight, allocateRiderLayout, measureRiderHeight, measureRiderLayout } from './riderListDensity.js';

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

  it('keeps the roomy gap while cards clear the floor', () => {
    // 5 riders, 3 headers (75), 7 gaps: (600 - 75 - 70) / 5 = 91
    expect(allocateRiderLayout({ room: 600, content: 75, gaps: 7, count: 5 })).toEqual({ height: 91, gap: 10 });
  });
  it('tightens the gap before the floor forces a scroll (the 17:05 roster)', () => {
    // RPM is pinned outside the list now: 457 - 75 headers - 7 x 10 = 312 / 5 = 62 < 64
    expect(allocateRiderLayout({ room: 457, content: 75, gaps: 7, count: 5 })).toEqual({ height: 70, gap: 4 });
    // (470 - 75 - 70) / 5 = 65 clears the floor, so the roomy gap stays.
    expect(allocateRiderLayout({ room: 470, content: 75, gaps: 7, count: 5 })).toEqual({ height: 65, gap: 10 });
  });
  it('choice does not depend on the gap the grid currently wears', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div class="device-grid">' + Array.from({ length: 5 }, () => '<div class="device-wrapper"><div class="device-zone-info"></div><div class="fitness-device card-horizontal heart-rate"></div></div>').join('') + '</div>';
    document.body.append(container);
    Object.defineProperty(container, 'clientHeight', { value: 340 });
    const grid = container.firstChild;
    [...grid.children].forEach(c => { c.getBoundingClientRect = () => ({ height: 64 }); });
    grid.querySelectorAll('.fitness-device').forEach(c => { c.getBoundingClientRect = () => ({ height: 64 }); });
    grid.style.gap = '4px';
    const a = measureRiderLayout(container, container);
    grid.style.gap = '10px';
    expect(measureRiderLayout(container, container)).toEqual(a);
    expect(a).toEqual({ height: 64, gap: 4 });
  });
});
