// tests/isolated/rendering/qrcode/QRCodeRenderer.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import { createQRCodeRenderer } from '../../../../backend/src/1_rendering/qrcode/QRCodeRenderer.mjs';

describe('QRCodeRenderer', () => {
  let renderer;

  beforeAll(() => {
    renderer = createQRCodeRenderer({ mediaPath: '/tmp' });
  });

  describe('renderSvg', () => {
    it('returns a valid SVG string', () => {
      const svg = renderer.renderSvg('test-data');
      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('</svg>');
    });

    it('contains circle elements for dot style', () => {
      const svg = renderer.renderSvg('test-data', { style: 'dots' });
      expect(svg).toContain('<circle');
    });

    it('contains rect elements for square style', () => {
      const svg = renderer.renderSvg('test-data', { style: 'squares' });
      expect(svg).toMatch(/<rect[^>]*class="module"/);
    });

    it('renders finder patterns as rounded rects', () => {
      const svg = renderer.renderSvg('test-data');
      expect(svg).toMatch(/<rect[^>]*class="finder"/);
    });

    it('respects custom foreground and background colors', () => {
      const svg = renderer.renderSvg('test-data', { fg: '#ff0000', bg: '#00ff00' });
      expect(svg).toContain('fill="#ff0000"');
      expect(svg).toContain('fill="#00ff00"');
    });

    it('respects custom size', () => {
      const svg = renderer.renderSvg('test-data', { size: 500 });
      // size 500 + margin 20*2 = 540
      expect(svg).toContain('width="540"');
    });

    it('includes label text when provided', () => {
      const svg = renderer.renderSvg('test-data', { label: 'My Label' });
      expect(svg).toContain('My Label');
    });

    it('includes sublabel text when provided', () => {
      const svg = renderer.renderSvg('test-data', { label: 'Title', sublabel: 'Subtitle' });
      expect(svg).toContain('Subtitle');
    });

    it('renders more dots when logo is disabled', () => {
      const svgNoLogo = renderer.renderSvg('test-data-1234567890', { logo: false });
      const svgWithLogo = renderer.renderSvg('test-data-1234567890');
      const dotsWithout = (svgNoLogo.match(/<circle/g) || []).length;
      const dotsWith = (svgWithLogo.match(/<circle/g) || []).length;
      expect(dotsWithout).toBeGreaterThanOrEqual(dotsWith);
    });

    it('embeds logo image when logoData is provided', () => {
      const svg = renderer.renderSvg('test-data', {
        logoData: 'data:image/png;base64,iVBOR',
      });
      expect(svg).toContain('<image');
      expect(svg).toContain('data:image/png;base64,iVBOR');
      expect(svg).toContain('clipPath');
    });

    it('adds option badge paths when provided', () => {
      const svg = renderer.renderSvg('test-data', {
        label: 'Test',
        optionBadges: ['M10 10L20 20'],
      });
      expect(svg).toContain('M10 10L20 20');
    });

    it('increases total height when label is present', () => {
      const svgNoLabel = renderer.renderSvg('test-data');
      const svgWithLabel = renderer.renderSvg('test-data', { label: 'Title' });
      const heightNo = parseInt(svgNoLabel.match(/height="(\d+)"/)[1]);
      const heightWith = parseInt(svgWithLabel.match(/height="(\d+)"/)[1]);
      expect(heightWith).toBeGreaterThan(heightNo);
    });
  });

  describe('cover layout', () => {
    it('uses wider SVG when coverData is provided', () => {
      const svgCentered = renderer.renderSvg('test-data');
      const svgCover = renderer.renderSvg('test-data', {
        coverData: 'data:image/png;base64,iVBOR',
        label: 'Album Title',
      });
      const widthCentered = parseInt(svgCentered.match(/width="(\d+)"/)[1]);
      const widthCover = parseInt(svgCover.match(/width="(\d+)"/)[1]);
      expect(widthCover).toBeGreaterThan(widthCentered);
    });

    it('embeds cover image element', () => {
      const svg = renderer.renderSvg('test-data', {
        coverData: 'data:image/jpeg;base64,ABCDEF',
        label: 'Test',
      });
      expect(svg).toContain('<image');
      expect(svg).toContain('data:image/jpeg;base64,ABCDEF');
    });

    it('does not mask center modules (no logo area)', () => {
      // Cover layout should have more dots than centered layout with logo
      const svgCover = renderer.renderSvg('test-data-long-string-12345', {
        coverData: 'data:image/png;base64,iVBOR',
      });
      const svgCentered = renderer.renderSvg('test-data-long-string-12345');
      const dotsCover = (svgCover.match(/<circle/g) || []).length;
      const dotsCentered = (svgCentered.match(/<circle/g) || []).length;
      expect(dotsCover).toBeGreaterThanOrEqual(dotsCentered);
    });

    it('includes label and sublabel', () => {
      const svg = renderer.renderSvg('test-data', {
        coverData: 'data:image/png;base64,iVBOR',
        label: 'My Album',
        sublabel: 'Artist Name',
      });
      expect(svg).toContain('My Album');
      expect(svg).toContain('Artist Name');
    });

    it('renders option badges on far right', () => {
      const svg = renderer.renderSvg('test-data', {
        coverData: 'data:image/png;base64,iVBOR',
        label: 'Test',
        optionBadges: ['M5 5L10 10'],
      });
      expect(svg).toContain('M5 5L10 10');
    });
  });
});
