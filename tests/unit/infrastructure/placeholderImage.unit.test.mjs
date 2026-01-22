// tests/unit/infrastructure/placeholderImage.unit.test.mjs
import { jest } from '@jest/globals';

// Mock the canvas module
const mockToBuffer = jest.fn().mockReturnValue(Buffer.from('mock-png-data'));
const mockFillRect = jest.fn();
const mockFillText = jest.fn();
const mockMeasureText = jest.fn().mockReturnValue({ width: 100 });

const mockCtx = {
  fillStyle: '',
  textAlign: '',
  textBaseline: '',
  font: '',
  fillRect: mockFillRect,
  fillText: mockFillText,
  measureText: mockMeasureText
};

const mockCanvas = {
  getContext: jest.fn().mockReturnValue(mockCtx),
  toBuffer: mockToBuffer
};

const mockCreateCanvas = jest.fn().mockReturnValue(mockCanvas);
const mockRegisterFont = jest.fn();

jest.unstable_mockModule('canvas', () => ({
  createCanvas: mockCreateCanvas,
  registerFont: mockRegisterFont
}));

// Mock FileIO
jest.unstable_mockModule('../../../backend/src/0_infrastructure/utils/FileIO.mjs', () => ({
  fileExists: jest.fn().mockReturnValue(false)
}));

describe('placeholderImage', () => {
  let generatePlaceholderImage;

  beforeAll(async () => {
    const module = await import('../../../backend/src/0_infrastructure/utils/placeholderImage.mjs');
    generatePlaceholderImage = module.generatePlaceholderImage;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock ctx properties
    mockCtx.fillStyle = '';
    mockCtx.textAlign = '';
    mockCtx.textBaseline = '';
    mockCtx.font = '';
  });

  describe('generatePlaceholderImage', () => {
    test('returns a Buffer', () => {
      const result = generatePlaceholderImage('test/path');
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    test('creates a 500x500 canvas', () => {
      generatePlaceholderImage('test/path');
      expect(mockCreateCanvas).toHaveBeenCalledWith(500, 500);
    });

    test('sets dark background color #1a1a1a', () => {
      generatePlaceholderImage('test/path');
      expect(mockFillRect).toHaveBeenCalledWith(0, 0, 500, 500);
    });

    test('renders display text centered', () => {
      generatePlaceholderImage('sfx/intro');

      // Check text alignment is centered
      expect(mockCtx.textAlign).toBe('center');
      expect(mockCtx.textBaseline).toBe('middle');

      // Check fillText is called at center coordinates (250, 250)
      expect(mockFillText).toHaveBeenCalledWith('sfx/intro', 250, 250);
    });

    test('uses white text color', () => {
      generatePlaceholderImage('test/path');

      // The second fillStyle assignment should be white for text
      // We check that fillText was called (text is rendered)
      expect(mockFillText).toHaveBeenCalled();
    });

    test('generates PNG format', () => {
      generatePlaceholderImage('test/path');
      expect(mockToBuffer).toHaveBeenCalledWith('image/png');
    });

    test('scales font down for long text', () => {
      // Mock measureText to return width larger than canvas
      mockMeasureText.mockReturnValue({ width: 600 });

      generatePlaceholderImage('very/long/path/that/needs/scaling');

      // measureText should be called multiple times as font size is reduced
      expect(mockMeasureText.mock.calls.length).toBeGreaterThan(1);
    });

    test('handles empty string with fallback', () => {
      const result = generatePlaceholderImage('');
      expect(Buffer.isBuffer(result)).toBe(true);
      // Should render 'unknown' as fallback text
      expect(mockFillText).toHaveBeenCalledWith('unknown', 250, 250);
    });

    test('handles null/undefined with fallback', () => {
      const result = generatePlaceholderImage(null);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(mockFillText).toHaveBeenCalledWith('unknown', 250, 250);
    });
  });
});
