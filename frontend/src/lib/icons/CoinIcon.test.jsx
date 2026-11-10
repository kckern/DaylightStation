/**
 * The household coin: the Twemoji coin (CC-BY 4.0), one component for every
 * on-screen coin, gold or silver.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CoinIcon, { COIN_PALETTES, COIN_METALS, coinPalette } from './CoinIcon.jsx';
import { hexToHsl } from './iconColor.js';

const svgOf = (ui) => render(ui).container.querySelector('svg');
const fills = (svg) => [...svg.querySelectorAll('[fill]')].map((n) => n.getAttribute('fill'));
// Darkest to lightest, as the art layers them.
const LADDER = ['rim', 'inner', 'face', 'light', 'highlight'];
const ascending = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('CoinIcon (Twemoji coin)', () => {
  it('draws the Twemoji coin on its 36-unit viewBox: four discs and eleven paths', () => {
    const svg = svgOf(<CoinIcon />);
    expect(svg.getAttribute('viewBox')).toBe('0 0 36 36');
    expect(svg.querySelectorAll('circle')).toHaveLength(4);
    expect(svg.querySelectorAll('path')).toHaveLength(11);
    expect(svg.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('gold is the default and is exactly the Twemoji five fills', () => {
    expect(COIN_METALS).toEqual(['gold', 'silver']);
    expect(COIN_PALETTES.gold).toEqual({ rim: '#f4900c', face: '#ffcc4d', highlight: '#ffe8b6', inner: '#ffac33', light: '#ffd983' });
    const svg = svgOf(<CoinIcon />);
    expect(svg.getAttribute('data-metal')).toBe('gold');
    expect(new Set(fills(svg))).toEqual(new Set(Object.values(COIN_PALETTES.gold)));
  });

  it('silver maps the same five roles to near-neutral greys in the same light order', () => {
    const svg = svgOf(<CoinIcon metal="silver" />);
    expect(svg.getAttribute('data-metal')).toBe('silver');
    expect(new Set(fills(svg))).toEqual(new Set(Object.values(COIN_PALETTES.silver)));
    for (const hex of Object.values(COIN_PALETTES.silver)) expect(hexToHsl(hex).s).toBeLessThan(0.12);
    expect(ascending(LADDER.map((r) => hexToHsl(COIN_PALETTES.gold[r]).l))).toBe(true);
    expect(ascending(LADDER.map((r) => hexToHsl(COIN_PALETTES.silver[r]).l))).toBe(true);
  });

  it('a hex color rebuilds the ladder around it and wins over metal; junk falls back', () => {
    const svg = svgOf(<CoinIcon metal="silver" color="#1e88e5" />);
    const hue = hexToHsl('#1e88e5').h;
    for (const f of fills(svg)) expect(Math.abs(hexToHsl(f).h - hue)).toBeLessThan(10);
    expect(coinPalette('silver', 'not-a-hex')).toBe(COIN_PALETTES.silver);
    expect(coinPalette('bronze')).toBe(COIN_PALETTES.gold);
  });

  it('size sets both dimensions; label makes it a named image', () => {
    const svg = svgOf(<CoinIcon size={48} label="3 silver" className="x" />);
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
    expect(svg.getAttribute('class')).toBe('coin-icon x');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title').textContent).toBe('3 silver');
  });
});
