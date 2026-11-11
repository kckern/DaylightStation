import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GENERIC_EQUIPMENT_FALLBACK_SRC, GenericEquipmentGlyph, StepMatGlyph } from "./EquipmentGlyph.jsx";

describe('EquipmentGlyph', () => {
  it('draws the step mat as a mat outline with two footprints', () => {
    const { container } = render(<StepMatGlyph className="glyph" />);
    const svg = container.querySelector('svg[data-glyph="step-mat"]');
    expect(svg.getAttribute('class')).toBe('glyph');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    const feet = [...svg.querySelectorAll('ellipse')];
    expect(feet).toHaveLength(4);
    // Mirrored about the vertical centre line: two on each side.
    expect(feet.filter((el) => Number(el.getAttribute('cx')) < 12)).toHaveLength(2);
    expect(feet.filter((el) => Number(el.getAttribute('cx')) > 12)).toHaveLength(2);
  });

  it('becomes a labelled image when given a title', () => {
    const { container } = render(<GenericEquipmentGlyph title="Equipment" />);
    const svg = container.querySelector('svg[data-glyph="equipment"]');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Equipment');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  it('exposes the neutral glyph as an inline SVG data URI, not a media-mount path', () => {
    expect(GENERIC_EQUIPMENT_FALLBACK_SRC.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(GENERIC_EQUIPMENT_FALLBACK_SRC.slice('data:image/svg+xml,'.length));
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 48 48');
    expect(doc.querySelectorAll('g rect')).toHaveLength(5);
  });
});
