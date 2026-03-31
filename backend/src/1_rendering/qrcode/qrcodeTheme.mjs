/**
 * Default theme for QR code SVG rendering.
 * @module rendering/qrcode/qrcodeTheme
 */
export const qrcodeTheme = {
  qr: {
    size: 300,
    margin: 20,
    dotScale: 0.85,
    errorCorrection: 'H',
  },

  finder: {
    outerRadius: 4,
    innerRadius: 2,
  },

  logo: {
    sizeRatio: 0.22,
    padding: 4,
  },

  frame: {
    borderRadius: 12,
    width: 32,           // Frame thickness (2rem = 32px)
    color: '#333333',    // Frame fill color
  },

  label: {
    height: 70,
    fontSize: 16,
    sublabelFontSize: 12,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineSpacing: 22,
    color: '#ffffff',
    sublabelColor: '#cccccc',
  },

  badge: {
    iconSize: 14,
    gap: 4,
  },

  colors: {
    foreground: '#000000',
    background: '#ffffff',
  },
};

export default qrcodeTheme;
