/**
 * QRCodeRenderer - Generates styled SVG QR codes.
 *
 * Uses the `qrcode` npm package for matrix generation and renders
 * custom SVG with dot-style modules, rounded finder patterns,
 * center logo, frame, labels, and option badges.
 *
 * @module rendering/qrcode/QRCodeRenderer
 */

import QRCode from 'qrcode';
import { qrcodeTheme } from './qrcodeTheme.mjs';

/**
 * Create a QR code renderer.
 * @param {Object} [config]
 * @param {string} [config.mediaPath] - Path to media directory
 * @returns {{ renderSvg: (data: string, options?: Object) => string }}
 */
export function createQRCodeRenderer(config = {}) {
  const theme = qrcodeTheme;

  /**
   * Render a QR code as an SVG string.
   * @param {string} data - Data to encode
   * @param {Object} [options]
   * @param {number} [options.size] - QR code size in pixels
   * @param {string} [options.style='dots'] - 'dots' or 'squares'
   * @param {string} [options.fg] - Foreground color
   * @param {string} [options.bg] - Background color
   * @param {string} [options.label] - Primary label text
   * @param {string} [options.sublabel] - Secondary label text
   * @param {string|false} [options.logoData] - Base64 data URI for logo
   * @param {boolean} [options.logo=true] - Enable/disable logo area masking
   * @param {string[]} [options.optionBadges] - SVG path strings for option badges
   * @returns {string} SVG markup
   */
  function renderSvg(data, options = {}) {
    const size = options.size || theme.qr.size;
    const style = options.style || 'dots';
    const fg = options.fg || theme.colors.foreground;
    const bg = options.bg || theme.colors.background;
    const margin = theme.qr.margin;
    const logoEnabled = options.logo !== false;
    const logoData = options.logoData || null;
    const label = options.label || null;
    const sublabel = options.sublabel || null;
    const optionBadges = options.optionBadges || [];

    // Generate QR matrix
    const qr = QRCode.create(data, {
      errorCorrectionLevel: theme.qr.errorCorrection,
    });
    const modules = qr.modules;
    const moduleCount = modules.size;
    const moduleSize = size / moduleCount;

    // Calculate SVG dimensions
    const totalWidth = size + margin * 2;
    const labelHeight = label ? theme.label.height : 0;
    const totalHeight = size + margin * 2 + labelHeight;

    // Logo mask area (center circle)
    const logoRadius = logoEnabled ? (size * theme.logo.sizeRatio) / 2 : 0;
    const centerX = size / 2;
    const centerY = size / 2;

    const parts = [];

    // SVG header
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

    // Frame background
    parts.push(`<rect width="${totalWidth}" height="${totalHeight}" rx="${theme.frame.borderRadius}" fill="${bg}" stroke="${theme.frame.strokeColor}" stroke-width="${theme.frame.strokeWidth}"/>`);

    // QR code group (offset by margin)
    parts.push(`<g transform="translate(${margin}, ${margin})">`);

    // Render data modules
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (!modules.get(row, col)) continue;
        if (isFinderPattern(row, col, moduleCount)) continue;

        const x = col * moduleSize + moduleSize / 2;
        const y = row * moduleSize + moduleSize / 2;

        // Skip modules inside logo mask
        if (logoEnabled) {
          const dx = x - centerX;
          const dy = y - centerY;
          if (Math.sqrt(dx * dx + dy * dy) < logoRadius + theme.logo.padding) continue;
        }

        if (style === 'dots') {
          const r = (moduleSize / 2) * theme.qr.dotScale;
          parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fg}"/>`);
        } else {
          const rectSize = moduleSize * theme.qr.dotScale;
          const offset = (moduleSize - rectSize) / 2;
          parts.push(`<rect class="module" x="${(col * moduleSize + offset).toFixed(2)}" y="${(row * moduleSize + offset).toFixed(2)}" width="${rectSize.toFixed(2)}" height="${rectSize.toFixed(2)}" fill="${fg}"/>`);
        }
      }
    }

    // Render finder patterns
    renderFinderPattern(parts, 0, 0, moduleSize, fg, bg);
    renderFinderPattern(parts, 0, moduleCount - 7, moduleSize, fg, bg);
    renderFinderPattern(parts, moduleCount - 7, 0, moduleSize, fg, bg);

    // Render logo
    if (logoEnabled && logoData) {
      const logoSize = logoRadius * 2;
      const logoX = centerX - logoRadius;
      const logoY = centerY - logoRadius;

      parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);
      parts.push(`<defs><clipPath id="logo-clip"><circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${logoRadius.toFixed(2)}"/></clipPath></defs>`);
      parts.push(`<image href="${escapeAttr(logoData)}" x="${logoX.toFixed(2)}" y="${logoY.toFixed(2)}" width="${logoSize.toFixed(2)}" height="${logoSize.toFixed(2)}" clip-path="url(#logo-clip)" preserveAspectRatio="xMidYMid slice"/>`);
    } else if (logoEnabled) {
      parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);
    }

    parts.push('</g>');

    // Label area
    if (label) {
      const labelY = size + margin * 2 + theme.label.fontSize + 4;
      parts.push(`<text x="${totalWidth / 2}" y="${labelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.fontSize}" font-weight="bold" fill="${theme.label.color}">${escapeXml(label)}</text>`);

      if (sublabel) {
        const sublabelY = labelY + theme.label.lineSpacing;
        parts.push(`<text x="${totalWidth / 2}" y="${sublabelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.sublabelFontSize}" fill="${theme.label.sublabelColor}">${escapeXml(sublabel)}</text>`);
      }

      if (optionBadges.length > 0) {
        const badgeY = labelY + (sublabel ? theme.label.lineSpacing : 0) + 4;
        const badgeStartX = totalWidth / 2 + 40;
        optionBadges.forEach((pathData, i) => {
          const bx = badgeStartX + i * (theme.badge.iconSize + theme.badge.gap);
          parts.push(`<g transform="translate(${bx}, ${badgeY - theme.badge.iconSize}) scale(${(theme.badge.iconSize / 24).toFixed(3)})"><path d="${pathData}" fill="${theme.label.sublabelColor}"/></g>`);
        });
      }
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  return { renderSvg };
}

function isFinderPattern(row, col, moduleCount) {
  if (row < 7 && col < 7) return true;
  if (row < 7 && col >= moduleCount - 7) return true;
  if (row >= moduleCount - 7 && col < 7) return true;
  return false;
}

function renderFinderPattern(parts, startRow, startCol, moduleSize, fg, bg) {
  const { outerRadius, innerRadius } = qrcodeTheme.finder;
  const x = startCol * moduleSize;
  const y = startRow * moduleSize;
  const outerSize = 7 * moduleSize;
  const midSize = 5 * moduleSize;
  const innerSize = 3 * moduleSize;
  const midOffset = moduleSize;
  const innerOffset = 2 * moduleSize;

  parts.push(`<rect class="finder" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${outerSize.toFixed(2)}" height="${outerSize.toFixed(2)}" rx="${outerRadius}" fill="${fg}"/>`);
  parts.push(`<rect x="${(x + midOffset).toFixed(2)}" y="${(y + midOffset).toFixed(2)}" width="${midSize.toFixed(2)}" height="${midSize.toFixed(2)}" rx="${innerRadius}" fill="${bg}"/>`);
  parts.push(`<rect x="${(x + innerOffset).toFixed(2)}" y="${(y + innerOffset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerRadius}" fill="${fg}"/>`);
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
