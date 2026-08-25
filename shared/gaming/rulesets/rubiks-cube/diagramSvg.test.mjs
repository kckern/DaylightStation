import assert from 'node:assert/strict';
import test from 'node:test';
import { createCube } from './engine.mjs';
import { cubeDiagramSvg } from './diagramSvg.mjs';

test('cube diagrams carry color letters and restrained monochrome fills', () => {
  const svg = cubeDiagramSvg(createCube(), { highlights: [{ face: 'U', index: 1 }] });
  assert.doesNotMatch(svg, /<pattern|crosshatch|diagonal|dots/);
  assert.match(svg, /fill="#f2f2f2"/);
  assert.match(svg, /fill="#bfbfbf"/);
  assert.match(svg, /text[^>]*>W<\/text>/);
  assert.match(svg, /stroke="#a11"/);
});
