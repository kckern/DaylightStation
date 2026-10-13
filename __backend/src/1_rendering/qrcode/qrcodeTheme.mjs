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
    color: '#aaaaaa',    // Frame fill color
  },

  label: {
    height: 80,
    fontSize: 26,
    sublabelFontSize: 19,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineSpacing: 24,
    color: '#000000',          // label text (on the white label box)
    sublabelColor: '#000000',  // sublabel text
    // Approximate char width as a fraction of font size (sans-serif) for
    // measurement-free SVG truncation.
    charWidthFactor: 0.55,
    box: {
      color: '#ffffff',  // label box fill
      gap: 4,            // gap between QR content area and label box
      radius: 8,         // label box corner radius
    },
  },

  badge: {
    iconSize: 14,
    gap: 4,
    color: '#666666',
  },

  colors: {
    foreground: '#000000',
    background: '#ffffff',
  },
};

export default qrcodeTheme;
